# Kairo API Spec

アドオン間通信（router ↔ router）を kairo が仲介する機能の仕様書。

---

## 概要

Minecraft Script API はグローバルな名前空間しかなく、アドオン間で直接関数呼び出しができない。
kairo が ScriptEvent を使ったルーティング層を提供することで、アドオンが互いの API を呼び出せるようにする。

呼び出し元は相手の addonId と API 名だけ知っていれば良く、kairoId や ScriptEvent の詳細は意識しない。

---

## router 側 API（アドオン開発者向け）

### API の提供・hook 宣言

`register` と `hook` は `router.beforeEvents.startup` の `ev.api` 経由でのみ呼び出せる。
startup イベント終了後に呼ぼうとするとエラー。

```typescript
ev.api.register<TArgs, TReturn>(apiName: string, handler: (args: TArgs) => TReturn | Promise<TReturn>): void
ev.api.hook<TArgs, TReturn>(targetAddonId: string, apiName: string, options: HookOptions<TArgs, TReturn>): void
```

- `addonId` は router のコンテキストから暗黙的に取得されるため指定不要。
- handler が実際に呼び出し可能になるのは activation 後。startup 段階ではまだ呼べない。
- 同一 addonId 内で同一 `apiName` を重複 `register` するとエラー。

```typescript
// 例
router.beforeEvents.startup.subscribe((ev) => {
    ev.customCommandRegistry.registerCommand(...);

    ev.api.register<{ playerId: string }, { balance: number }>(
        "economy/getBalance",
        async ({ playerId }) => ({ balance: 100 }),
    );

    ev.api.hook<{ amount: number }, void>("other-addon", "economy/deposit", {
        priority: -10,
        before: async (ctx) => {
            if (ctx.args.amount < 0) ctx.cancel();
        },
    });
});
```

### API の呼び出し

```typescript
// fire-and-forget（返答を待たない）
router.send(targetAddonId: string, apiName: string, args?: unknown): void

// 結果を待つ（Promise）
router.request<TReturn>(
    targetAddonId: string,
    apiName: string,
    args?: unknown,
    options?: { timeout?: number }  // タイムアウト（tick）。デフォルト 20 tick。
): Promise<TReturn | CancelledResult>
```

- `targetAddonId`: 呼び出し先アドオンの addonId（kairoId ではない）。

**`send` の実行モデル**
`send` は caller へ即座に `void` で return する。kairo 内部では before hook を実行し、成功した場合に ApiInvoke を送信する。**ApiInvoke 送信時点で send パイプラインは完了**（Completed）。handler の応答（ApiHandlerResponse）は不要であり、router 側も type="send" の invoke に対して ApiHandlerResponse を送信しない。send に watchdog・pending・timeout は存在しない。caller はパイプラインの完了・エラー・rollback を観測できない。

**`send` のエラー挙動（すべてスルー）**
- 対象 addonId が存在しない / inactive / unresolved でも無視する。
- API 名が存在しない場合も無視する。
- hook でキャンセルされても呼び出し元には伝わらない。
- hook が例外をスローしても caller には伝播しない。ただし kairo は内部でログ出力すること（SHOULD）。
- ハンドラが例外をスローしても caller には伝播しない。同様にログ出力すること（SHOULD）。
- **順序保証なし**: `send` の到達順は未規定（unspecified）。Consumer は到達順に依存してはならない（MUST NOT）。

**`request` のエラー評価順序（この順で判定し、最初にマッチした結果を返す）**

| 順序 | チェック内容 | 挙動 |
|---|---|---|
| 1 | 対象 addonId がルーティングテーブルに存在しない | `{ cancelled: true, reason: "ADDON_NOT_FOUND" }` |
| 2 | 対象 addonId の active インスタンスが inactive | `{ cancelled: true, reason: "ADDON_INACTIVE" }` |
| 3 | 対象 addonId の active インスタンスが unresolved | `{ cancelled: true, reason: "ADDON_UNRESOLVED" }` |
| 4 | apiName がルーティングテーブルに存在しない | Promise reject（`ApiNotFoundError`） |
| 5 | before hook が例外をスロー | Promise reject（`BeforeHookExecutionError`）。cancel とは別扱い |
| 6 | hook により cancel された | `{ cancelled: true, reason: "CANCELLED_BY_HOOK" }` |
| 7 | ハンドラが例外をスロー | Promise reject（`HandlerExecutionError`） |
| 8 | タイムアウト | Promise reject（`RequestTimeoutError`） |

> 評価順序が確定しているため、アドオンが inactive の場合は API の存在チェックに到達しない。
> "API_NOT_FOUND" と "ADDON_INACTIVE" が競合することはない。
> hook の throw は cancel ではなく failure として扱う（cancel ≠ failure）。

```typescript
type CancelledResult = {
    readonly cancelled: true;
    readonly reason: "ADDON_NOT_FOUND" | "ADDON_INACTIVE" | "ADDON_UNRESOLVED" | "CANCELLED_BY_HOOK";
};

// request が Promise reject する場合の Error 型（instanceof で分類可能）
class ApiNotFoundError          extends Error {}  // API 名がルーティングテーブルに存在しない
class RequestTimeoutError       extends Error {}  // タイムアウト
class BeforeHookExecutionError  extends Error {}  // before hook が例外をスロー → rollback が発火
class AfterHookExecutionError   extends Error {}  // after hook が例外をスロー → handler result は破棄
class HandlerExecutionError     extends Error {}  // ハンドラが例外をスロー
type ProtocolStage = "ApiCall" | "ApiInvoke" | "ApiResult" | "ApiHandlerResponse";

class ProtocolError extends Error {            // メッセージのパース失敗・スキーマ不一致（ハンドラとは無関係）
    constructor(
        message: string,
        readonly source: "local_parse" | "remote",
        readonly protocolStage?: ProtocolStage,  // デバッグ用
        readonly correlationId?: string,          // 対象 request の correlationId（判明している場合）
    ) { super(message); }
    // source="local_parse": ローカルでの JSON パース失敗・スキーマ不一致（ScriptEvent 受信側）
    // source="remote":      kairo から errorType="PROTOCOL_ERROR" を受信
}
```

```typescript
// 例
router.send("economy-addon", "onTransaction", { amount: 50 });

const result = await router.request<{ balance: number }>("economy-addon", "getBalance", { playerId: "..." });
if ("cancelled" in result) {
    // キャンセルされた場合
    console.log(result.reason);
} else {
    console.log(result.balance);
}

// タイムアウトを延長したい場合
const result = await router.request("economy-addon", "heavyCalc", args, { timeout: 100 });
```

**`request<TReturn>` の型安全**: 型パラメータ `TReturn` はコンパイル時のみ有効。runtime での型検証は行われない。handler / hook cancel が型違反の値を返した場合、caller でサイレントな型破壊が起きる。

**`request` の ordering**: 複数の `request` を連続して呼んだ場合の到達順は未規定（unspecified）。これは同一 `targetAddonId` + 同一 `apiName` への連続呼び出しにも適用される。ハンドラが受け取る呼び出し順は送信順と異なる場合があり、`before` hook に async 処理が含まれる場合は特に顕著。順序依存の処理は呼び出し側で直列制御すること（例: 前の request の完了を await してから次を呼ぶ）。

**fairness 保証なし**: ordering は unspecified であり特定の request が他より先に処理される保証はない。ただし実行を開始した request は timeout 発生を除いて最終的に処理される（no starvation 保証）。

**hook author の並行実行耐性（MUST）**: request ordering が unspecified であるため、複数の request が同一 before hook chain を並行実行する可能性がある。before hook は実行順が変わっても正しく動作しなければならない（MUST）。グローバル状態や共有カウンタ等への書き込みは、並行実行時の order dependence に注意すること。

### API の hook

`ev.api.hook()` の詳細仕様（startup イベント内でのみ呼び出せる）。

```typescript
type HookOptions<TArgs, TReturn> = {
    priority?: number;
    // version は将来用（未実装）。public API には現時点では公開しない
    modes?: ReadonlyArray<"send" | "request">;
    // default: after が存在する場合 → ["request"]、before のみ → ["send", "request"]
    // after を send 対象にしたい場合のみ ["send", "request"] を明示する
    before?: (ctx: BeforeHookContext<TArgs, TReturn>) => Promise<void>;
    after?: (ctx: AfterHookContext<TArgs, TReturn>) => Promise<void>;
    rollback?: (ctx: HookRollbackContext<TArgs>) => Promise<TArgs | void>;  // before throw 時のみ発火。TArgs を返すと後続 rollback への引き渡し値になる。void は変更なし
};
```

- `before` / `after` は両方省略不可（少なくとも片方が必要）。両方を省略した `HookOptions` は `ev.api.hook()` 呼び出し時点で同期的に `Error` をスローする（startup 内で即座に検出される）。
- `priority`: 32-bit 符号付き整数（`-2^31` 〜 `2^31 - 1`）。小さいほど先に実行される。省略時は `0`。
- **同値の tie-break**: `priority asc → sequence asc`。sequence number の採番ルール：
  1. **cross-addon**: hook を提供するアドオンの `addonId` の辞書順でソート（ScriptEvent 到着順に依存しないため完全 deterministic）
  2. **within same addonId**: router が保持する単調増加カウンタで採番する。`ev.api.hook()` の呼び出し時点でカウンタをインクリメントして sequence を確定する。複数の `startup.subscribe()` callback を使用しても呼び出し順が sequence を決定するため callback の境界は無関係。deterministic かつシンプル。複数 addon 間の startup 実行順は Minecraft の仕様上不定のため cross-addon には適用しない。
  - addonId 順は永続的・不変のフォールバックであり、意味を持たせないこと。実行順を意図的に制御したい場合は必ず priority を使うこと（priority inflation を避けるため、-100/0/100 など疎なレンジを推奨）。
- `targetAddonId` に対する dependency 宣言は不要。
- **hook chain の call-scoped snapshot（MUST）**: request フローの step 3（ApiCall 受信時点・call 開始点）に一度だけ activation state を確認し、active な hook provider の hook のみを含む参加 hook 一覧を確定する。これは routing target の snapshot と同一タイミング（step 3）で行う（MUST）。step 3 以降の activation state 変化（hook providers・target addon）は当該 call に一切影響しない（MUST NOT 参照）。`before` が実行された hook の `after` / `rollback` は hook provider がその後 deactivate しても当該 call 内で確実に実行される。
- **opt-out モデル**: `before` 内で `ctx.cancel()` を呼ばない限り自動的に次へ進む。`cancel()` は hook 関数の実行を abort しない。`cancel()` 後は即座に `return` すること（MUST）。TypeScript は `cancel(): never` によりコンパイル時に後続コードを unreachable として警告する。
- **cancel の伝播**: `ctx.cancel()` が呼ばれると、それ以降の hook（`before` / `after` 両方）とハンドラはすべてスキップされる。
- **`ctx.cancel(result?)` の原子性**: result の設定と cancel は `ctx.cancel(result)` として原子的に行う。`cancel()` 呼び出し時点の result が最終値となる。
- **hook throw の semantics（request / before）**: `before` hook が例外をスローした場合、その call は即座に abort する（ハンドラは実行しない）。成功済みの `before` hook に対応する **`rollback`** を逆順で実行する。`BeforeHookExecutionError` で reject。
  ```
  before #1 成功 → stack に push（rollbackData_1 = setRollbackData で格納した値）
  before #2 成功 → stack に push（rollbackData_2）
  before #3 throw
  → rollback #2（rollbackData: rollbackData_2, currentArgs: 現在の args）
  → rollback #1（rollbackData: rollbackData_1, currentArgs: rollback #2 実行後の args）
  → handler は実行しない
  ```
  **rollback の実行は best-effort**。rollback 内で例外が発生した場合はログを出力して次の rollback を続行する（rollback failure が他の rollback を止めてはならない）。
- **hook throw の semantics（send）**: `before` hook が例外をスローした場合、ハンドラは実行しない。request と同様に成功済み `before` の **`rollback`** を逆順で実行する（before hook が副作用を持つ場合があるため）。caller が存在しないためエラーは返さない。rollback failure はログのみ。
- **`after` hook throw の semantics（request のみ）**: `after` hook が例外をスローした場合、それ以降の `after` hook の実行を中断し、ハンドラの result は破棄して `AfterHookExecutionError` で reject する。すでに実行済みの `after` hook は差し戻せない（rollback なし）。`send` には after フェーズが存在しないためこのセマンティクスは適用されない。
  ```
  handler success → result = R
  after #1 成功（R を改ざん可）
  after #2 throw
  → after #3 はスキップ
  → caller は AfterHookExecutionError で reject（R は破棄）
  ```
- **`send` に対する hook と `modes`**: `send` には after フェーズが存在しない（fire-and-forget のためハンドラ応答がない）。`modes` を省略かつ `after` が存在する場合、デフォルトで `modes: ["request"]` として扱われ send には適用されない。`modes: ["send", "request"]` を明示した場合は send でも before が実行される（after は send でも実行されない）。`after` を含む hook が send call に一致した場合、kairo は初回のみ警告ログを出力する（SHOULD）。
- **`before` でのショートサーキット**: `ctx.cancel(result)` を呼ぶとハンドラをスキップして result を返す（キャッシュ返却など）。`ctx.cancel()` のみ（引数なし）は `CANCELLED_BY_HOOK` を返す。
- **cancel と rollback の関係（MUST 理解）**: `ctx.cancel()` は正常な short-circuit であり rollback を起動しない。成功済みの before hook で副作用（lock acquire・resource 確保等）がある場合、cancel 後にそれらが残留する。cancel path での cleanup は hook 自身が担うこと（MUST）。rollback は before throw（異常終了）にのみ発火する。cleanup を怠ると resource leak が起きる。
  ```typescript
  // 悪い例：cancel 時に lock が残留する
  before: async (ctx) => {
      acquireLock();
      setRollbackData({ locked: true });
      if (!ctx.args.valid) ctx.cancel();  // ← lock 残留
  }
  // 良い例：cancel 前に cleanup する
  before: async (ctx) => {
      acquireLock();
      setRollbackData({ locked: true });
      if (!ctx.args.valid) { releaseLock(); ctx.cancel(); }
  }
  ```
- **前方参照 hook（forward hook）**: 対象 API がまだ manifest に含まれていない場合は、Registration phase finalized 時に照合する。

**実行順序（オニオンモデル）: `after` の実行順は before chain の実際の実行順の完全逆順（MUST）**
priority の数値逆順ではなく、before が実際に実行されたシーケンスの逆順。tie-break（addonId 辞書順）の結果も含めて逆転する。
```
// priority 同値時: addonId 辞書順で B < C とする
before: -10 → 0(B) → 0(C) → 5 → handler → after: 5 → 0(C) → 0(B) → -10
```

```typescript
router.beforeEvents.startup.subscribe((ev) => {
    // 例：前処理のみ（args 改ざん）
    ev.api.hook("addon-a", "test", {
        before: async (ctx) => {
            ctx.args = { ...ctx.args, injected: true };
        },
    });

    // 例：キャンセル
    ev.api.hook("addon-a", "test", {
        before: async (ctx) => {
            if (ctx.args.forbidden) ctx.cancel();
        },
    });

    // 例：ハンドラをスキップして自前の結果を返す
    ev.api.hook("addon-a", "economy/getBalance", {
        before: async (ctx) => {
            const cached = cache.get(ctx.args.playerId);
            if (cached) ctx.cancel(cached);  // result と cancel は原子的に
        },
    });

    // 例：後処理（result 改ざん）
    ev.api.hook("addon-a", "economy/getBalance", {
        after: async (ctx) => {
            ctx.result = { ...ctx.result, taxApplied: true };
        },
    });

    // 例：前処理 + 後処理（ローカル変数共有はクロージャで）
    function createTimingHook() {
        let startTime: number;
        return {
            priority: 5,
            before: async (_ctx: unknown) => { startTime = Date.now(); },
            after:  async (_ctx: unknown) => { console.log(Date.now() - startTime); },
        };
    }
    ev.api.hook("addon-a", "test", createTimingHook());
});
```

---

## HookContext

フェーズ別に3つの型が存在する。

```typescript
// before フェーズ：ハンドラ実行前
type BeforeHookContext<TArgs, TReturn> = {
    args: TArgs;                                  // 変更可能（改ざん可）
    readonly callerAddonId: string;
    cancel(result?: TReturn): never;              // result あり → ショートサーキット。なし → CANCELLED_BY_HOOK
    // never: TypeScript control flow 上 unreachable。cancel() 以降のコードをコンパイラが警告する。
    // cancel() は実行を abort しない。author は cancel() 後即座に return すること（MUST）。
    setRollbackData(data: unknown): void;         // rollback 時に使いたいデータを格納。rollback 未登録時は無視
};

// after フェーズ：ハンドラ実行後（request のみ。send には after フェーズが存在しない）
// args は変更禁止。TypeScript が shallow readonly を強制する。
// ネストオブジェクトへの deep mutation は仕様違反（undefined behavior）。実行時には検出されない。
type AfterHookContext<TArgs, TReturn> = {
    readonly args: TArgs;           // 変更禁止（TypeScript は shallow のみ強制。deep mutation は仕様違反）
    result: TReturn;                // 必ず値あり（変更可）
    readonly callerAddonId: string;
    // cancel() なし（ハンドラはすでに実行済み）
};

// rollback フェーズ：before hook が例外をスローした時のみ発火（send / request 両方）
// handler は実行されていないため result が存在しない。after とは別物。
type HookRollbackContext<TArgs> = {
    readonly rollbackData: unknown;                    // setRollbackData() で格納した値。未設定なら undefined
    readonly currentArgsSnapshot: DeepReadonly<TArgs>; // この rollback 実行時点の args スナップショット（前の rollback の返り値 or 初期値）
    readonly callerAddonId: string;
};
// 戻り値 TArgs: 後続 rollback が currentArgsSnapshot として受け取る
// 戻り値 void:  args を変更しない（後続 rollback は自分と同じ snapshot を受け取る）
// DeepReadonly<T> は型レベルでの再帰的 readonly。runtime freeze は行わない。
// currentArgsSnapshot は logical snapshot を意味する（deep clone ではない）。
// rollback 実行後に同オブジェクトを mutation すると後続 rollback の snapshot が壊れる（undefined behavior）。
// author は snapshot を mutation してはならない（MUST NOT）。返り値で新しいオブジェクトを作ること。
```

### cancel() の挙動

```
ctx.cancel(result) が呼ばれた場合 → result の値を呼び出し元に返す（成功扱い）
ctx.cancel()       が呼ばれた場合 → { cancelled: true, reason: "CANCELLED_BY_HOOK" } を返す
```

**`ctx.cancel(result)` は hook の short-circuit response**。
result の設定と cancel は 1 回の `cancel(result)` 呼び出しで原子的に行う。
ハンドラを実行させず、hook が代わりにレスポンスを返すことができる（キャッシュ返却など）。
この挙動は意図的な設計であり、hook author はハンドラになりすます責任を持つ。

**型安全の責任**: `cancel(result)` の引数はコンパイル時 generics で型チェックされるが、ランタイムでは検証されない。hook author は `TReturn` の契約を守ること。型違反の値を渡した場合、呼び出し元でサイレントな型破壊が起きる。

**cancel() は冪等（idempotent）。first call wins**。
同一の `before` hook 内や複数の hook chain で `cancel()` が複数回呼ばれた場合、最初の呼び出しのみが有効。以降の呼び出しは無視される。

**cancel() 時、addon の after hook は一切実行されない。kairo 本体 hook の after は cancel に関わらず実行される**。
addon 作者が登録した after hook は cancel でスキップされる。kairo 本体が `kairo.api.hook()` で登録した after hook（ロギング・メトリクス等）は cancel 状態に関わらず必ず実行される（before と同じく cancel 無視）。

**kairo 本体 hook の after throw は非 fatal**。
kairo 本体 hook の `after` 内で例外が発生した場合、kairo が内部でキャッチしてログを出力する（caller には伝播しない）。
これは観測系 hook（ロギング・メトリクス）が result を破壊しないための保護。
addon 作者が登録した `after` hook が例外をスローした場合は従来通り `AfterHookExecutionError` で reject する（result 変換の安全性を優先）。
`after` hook 内で例外が発生しうる副作用（外部サービス呼び出し等）は、hook 内部で try/catch すること（MUST）。

この区別により、横断的な観測性（observability）は kairo 本体が保証し、addon hook はビジネスロジックのみを担う。

### rollback の data

rollback author は `setRollbackData()` で格納したデータと `currentArgs`（rollback 実行時点の状態）を参照できる。

```typescript
// before フェーズで rollback に必要なデータを記録する
before: async (ctx) => {
    const oldBalance = ctx.args.balance;
    ctx.setRollbackData({ oldBalance });   // 自分が変更した内容だけ保存
    ctx.args.balance += 100;
},
// rollback は自分のスナップショットを基に新しい args を返す
rollback: async (ctx): Promise<{ balance: number }> => {
    const { oldBalance } = ctx.rollbackData as { oldBalance: number };
    return { ...ctx.currentArgsSnapshot, balance: oldBalance };  // spread して変更分だけ上書き
},
```

```
before A: setRollbackData({ old: 100 }) → args.balance = 200
before B: setRollbackData({ old: 200 }) → args.balance = 300
before C: throw

rollback B: currentArgsSnapshot = { balance: 300 }
  → returns { balance: 200 }          ← B が追加した分を元に戻した値

rollback A: currentArgsSnapshot = { balance: 200 }   ← B の return が渡ってくる
  → returns { balance: 100 }          ← A が追加した分を元に戻した値
  → 各 rollback は自分の変更だけを考えればよい
```

rollback chain は「前の rollback の返り値を次の rollback の snapshot として渡す fold 操作」である。
`setRollbackData()` を呼ばなかった hook の `rollbackData` は `undefined`。
rollback が `void` を返した場合は args を変更しない（後続 rollback は同じ snapshot を受け取る）。
kairo による自動 deep clone は行わない。

---

---

## API Declaration Phase

### 全体フロー

```
startup イベント（worldLoad より前）
  └ router.register() / router.hook() → router 内にローカル保持（kairoId 未割り当て）

worldLoad
  └ Discovery → Registration
       └ Registration 成功時: RegistrationResponse に API manifest を同梱して送信

全 Registration 完了後（kairo 側）
  └ ルーティングテーブル構築
  └ forward hook の照合・検証

Activation 開始
  └ handler が実際に呼び出し可能になる
```

### 宣言タイミング（startup イベント）

Minecraft の `startup` イベント（`worldLoad` より前に発火）で `register` / `hook` を呼ぶ。
この時点では kairoId がまだ割り当てられていないため、宣言は router 内にローカル保持される。

```typescript
// startup イベント内（worldLoad より前）
router.beforeEvents.startup.subscribe((ev) => {
    ev.api.register<{ playerId: string }, { balance: number }>(
        "economy/getBalance",
        async ({ playerId }) => ({ balance: 100 }),
    );
    ev.api.hook("other-addon", "economy/deposit", {
        before: async (ctx) => { /* ... */ },
    });
    // Minecraft カスタムコマンドも同じ場所で登録できる
    ev.customCommandRegistry.registerCommand(...);
});
```

### Manifest 送信（Registration 成功後）

Registration が成功してアドオンが `kairoId` を得た直後、router は API manifest を kairo に送信する。
manifest は `RegistrationResponse` に含めて送信する（追加フェーズは設けない）。

```
manifest 内容:
  - 提供 API 一覧: [{ name: "economy/getBalance" }, ...]
  - hook 宣言一覧: [{ targetAddonId: "economy-addon", apiName: "economy/getBalance", priority: 0, phases: ["before"] }, ...]
  ※ version は将来用フィールドのため manifest には含めない（HookOptions には存在するが wire format に載せない）
```

### kairo 側での管理（全 Registration 完了後）

kairo は全アドオンの Registration が完了した時点でルーティングテーブルを構築する。

```
ルーティングテーブル:
  "economy-addon" → {
      "getBalance" → kairoId_A,
      "deposit"    → kairoId_A,
  }

フック登録テーブル:
  "economy-addon::getBalance" → [
      { kairoId: kairoId_B, priority: 0, phases: ["before"] },
      { kairoId: kairoId_C, priority: 10, phases: ["before", "after"] },
  ]
```

前方参照（まだ manifest が届いていない addonId を hook しようとしているケース）は、
**Registration phase finalized（登録フェーズのタイムアウト完了時点）** に照合する。
一部の Registration が失敗してもフェーズは終了する。
以下のいずれかに該当する hook は警告ログを出力して無視する（SHOULD）：
- target addon の manifest 自体が届いていない（addon が Registration に失敗・未登録）
- target addon の manifest は届いているが、指定した apiName が含まれていない

警告ログには hook を提供したアドオンの `addonId` と target `addonId::apiName` を含めること（MUST）。これにより dependency 宣言漏れを hook author が特定できる。

**hook resolution は Registration phase finalized 時点で確定し、以降は immutable**。
動的な Activation / deactivation によってルーティングテーブルや hook テーブルは変化しない。
各 hook のスキップ判断は実行時に hook provider アドオンの activation state を動的参照して行う（テーブルからエントリは消えない）。
将来的に動的リロードを追加する場合は別途 cache invalidation policy を定義すること。

**routing table と activation state の関係**: routing table は ACTIVE・INACTIVE・UNRESOLVED を問わず、登録済みの全アドオンの API を含む。activation state のチェック（評価順 2・3）が先行するため、UNRESOLVED なアドオンへの `request` は API_NOT_FOUND に到達しない（ADDON_UNRESOLVED が返る）。

### 重複登録

```
同一アドオンが同一 apiName で register を2回呼んだ場合 → Error をスロー
異なる addonId が同一 apiName で register した場合 → 許可（addonId で識別）
```

---

## kairo 本体側の hook API

kairo 本体は全アドオンの API 呼び出しをルーティングするため、横断的な hook を設定できる。
用途: ロギング、レート制限、認可チェックなど。
登録タイミング: kairo の初期化時（Activation Phase 開始前）。

```typescript
// kairo 本体側（packs/kairo 内）
kairo.api.hook("economy-addon", "getBalance", {
    priority: -100,  // 全アドオンの hook より先に実行したい場合は小さい値
    before: async (ctx) => { /* ロギング */ },
    after:  async (ctx) => { /* ロギング */ },
});
```

インターフェースは `router.hook` と同一。kairo は特別な priority 制約を受けない。

---

---

## プロトコル（内部実装・ユーザー不可視）

ScriptEvent を使って kairo ↔ router 間で通信する。ユーザーは `router.send()` / `router.request()` を呼ぶだけでよい。
メッセージは `JSON.stringify` でシリアライズする。パフォーマンスが必要な場合は `fast-json-stringify` を推奨するが必須ではない。
スキーマ定義は TypeBox を使用する（kairo 内部の慣習に合わせる）。

### ScriptEvent ID 体系

| 方向 | Event ID | 用途 |
|---|---|---|
| Router → Kairo | `kairo:api-call` | send / request の呼び出し |
| Kairo → Router（ハンドラ側） | `{kairoId}:api-invoke` | ハンドラへの実行指示 |
| Router（ハンドラ）→ Kairo | `kairo:api-response` | ハンドラの結果返送 |
| Kairo → Router（呼び出し元） | `{correlationId}:api-result` | request の最終結果返送 |

### メッセージスキーマ

```typescript
// Router → Kairo: API 呼び出し開始
// callerKairoId は payload に含めない。kairo が ScriptEvent の送信元から実 kairoId を確定する。
// correlationId 形式は opaque（内部実装の詳細）。呼び出し元 router が一意性を保証する責務を持つ。
// correlationId はアクティブな request 全体でグローバルに一意でなければならない（MUST）。重複すると replay attack / response 混同が起きる。
const ApiCallSchema = Type.Object({
    type:          Type.Union([Type.Literal("send"), Type.Literal("request")]),
    correlationId: Type.String(),   // request のみ使用。send は空文字
    targetAddonId: Type.String(),
    apiName:       Type.String(),
    args:          Type.String(),   // JSON.stringify(args)
    timeout:       Type.Optional(Type.Integer({ minimum: 1 })),  // tick。省略時はデフォルト 20 tick
    timestamp:     Type.Integer({ minimum: 0 }),
});

// Kairo → Router（ハンドラ側）: 実行指示
// Router MUST validate that this event's sender is kairo（kairo の kairoId と一致するか確認）。
// 不一致の場合は無視すること（invoke spoofing 防止）。kairo の kairoId は Registration フェーズで取得済み。
//
// kairo 側も ApiHandlerResponse の sender を検証すること:
//   pending.targetKairoId == response sender の kairoId  →  valid
//   不一致の場合は drop + 警告ログ（MUST）
// これにより correlationId を推測した悪意あるアドオンが他アドオンへの response を偽造できなくなる。
//
// 注意: Event ID "{kairoId}:api-invoke" は kairoId が漏洩した場合にチャンネル自体が露出する。
// Minecraft ScriptEvent の subscription 分離が不完全な場合、悪意あるアドオンが同チャンネルを
// 購読できる可能性がある。sender validation はベストエフォートのセキュリティ対策であり、
// Minecraft のイベント分離モデルに依存している既知の制限事項。
// type="send": Router はハンドラを実行するが ApiHandlerResponse を送信しない（MUST NOT）
// type="request": Router はハンドラを実行し ApiHandlerResponse を送信する（MUST）
const ApiInvokeSchema = Type.Object({
    type:          Type.Union([Type.Literal("send"), Type.Literal("request")]),
    correlationId: Type.String(),   // send は空文字
    callerAddonId: Type.String(),   // kairoId ではなく addonId（ユーザー向け）
    apiName:       Type.String(),
    args:          Type.String(),   // hook before フェーズで改ざんされた後の値
    timestamp:     Type.Integer({ minimum: 0 }),
});

// Router（ハンドラ）→ Kairo: ハンドラ結果（request のみ）
// kairoId は含めない。kairo が ScriptEvent 送信元から誰の応答か確定する（spoofing 防止）。
const ApiHandlerResponseSchema = Type.Object({
    correlationId: Type.String(),
    success:       Type.Boolean(),
    result:        Type.Optional(Type.String()),  // JSON.stringify(result)。success=true のみ
    error:         Type.Optional(Type.String()),  // エラーメッセージ。success=false のみ
    timestamp:     Type.Integer({ minimum: 0 }),
});

// Kairo → Router（呼び出し元）: 最終結果（request のみ）
// success=true  → result あり
// success=false, cancelled=true → CancelledResult（アドオン状態・hook cancel）
// success=false, errorType あり → failure（hook/handler 例外・API 不存在）
const ApiResultSchema = Type.Object({
    correlationId: Type.String(),
    success:       Type.Boolean(),
    result:        Type.Optional(Type.String()),          // success=true のみ。JSON.stringify(result)
    cancelled:     Type.Optional(Type.Literal(true)),     // success=false + cancelled 時
    reason:        Type.Optional(Type.String()),          // cancelled 時の CancelledResult reason
    errorType:     Type.Optional(Type.Union([             // success=false + failure 時
        Type.Literal("API_NOT_FOUND"),
        Type.Literal("BEFORE_HOOK_EXECUTION"),         // before hook が例外をスロー → rollback 実行済み
        Type.Literal("AFTER_HOOK_EXECUTION"),          // after hook が例外をスロー → result 破棄
        Type.Literal("HANDLER_EXECUTION"),
        Type.Literal("TIMEOUT"),
        Type.Literal("PROTOCOL_ERROR"),               // パース失敗・スキーマ不一致
    ])),
    error:         Type.Optional(Type.String()),          // エラーメッセージ
    timestamp:     Type.Integer({ minimum: 0 }),
    // protocolStage は wire format から除外（remote の debug 情報は信用しない。router はローカル文脈で付与）
});

// Registration 時に router が送る API manifest（RegistrationResponse に追加）
// version は HookOptions に存在するが wire format には含めない（将来追加予定）
const ApiManifestSchema = Type.Object({
    apis: Type.Array(Type.Object({
        name: Type.String(),
    })),
    hooks: Type.Array(Type.Object({
        targetAddonId: Type.String(),
        apiName:       Type.String(),
        priority:      Type.Integer({ minimum: -2147483648, maximum: 2147483647 }),
        phases:        Type.Array(Type.Union([Type.Literal("before"), Type.Literal("after")])),
        // rollback は before の実装詳細（wire format には不要）
    })),
});
```

### パースエラー時の挙動

**kairo 側（ApiCall のパース失敗）**
JSON パースエラーまたは TypeBox スキーマ検証エラーが発生した場合、`correlationId` が引けない可能性があるため送信元への応答ができない。警告ログを出力して即 drop すること（SHOULD）。これは **unrecoverable protocol failure** であり、ApiResult を返す手段が存在しない。

**kairo 側（ApiHandlerResponse の処理失敗）**

| 失敗の種類 | errorType | 理由 |
|---|---|---|
| JSON パースエラー・スキーマ検証エラー | `PROTOCOL_ERROR` | トランスポート層の問題。ハンドラとは無関係 |
| ハンドラが `JSON.stringify` 不可能な値を返した（循環参照等） | `HANDLER_EXECUTION` | ユーザーコードの問題 |

いずれの場合も该当 `correlationId` の pending を削除し、Router(B) に対応する `ApiResult` を送信すること（MUST）。

**Router 側（ApiResult / ApiInvoke のパース失敗）**
`ApiResult` のパース失敗: 該当 `correlationId` の Promise を `new ProtocolError("...", "local_parse", "ApiResult", correlationId)` で reject し、pending から削除すること（MUST）。
`ApiInvoke` のパース失敗: 警告ログを出力して無視すること（SHOULD）。

### errorType → Error class 変換（router 側）

kairo から `ApiResult.errorType` を受け取った router は以下のように JS Error に変換して reject する：

| `errorType` | reject する Error クラス |
|---|---|
| `"API_NOT_FOUND"` | `new ApiNotFoundError()` |
| `"BEFORE_HOOK_EXECUTION"` | `new BeforeHookExecutionError()` |
| `"AFTER_HOOK_EXECUTION"` | `new AfterHookExecutionError()` |
| `"HANDLER_EXECUTION"` | `new HandlerExecutionError()` |
| `"TIMEOUT"` | `new RequestTimeoutError()` |
| `"PROTOCOL_ERROR"` | `new ProtocolError("...", "remote", "ApiResult", result.correlationId)` ※ stage はローカル文脈（remote の値を信用しない） |
```

### 責務分担

```
router（呼び出し元）: ApiCall 送信・ApiResult 受信のみ（timeout 管理しない）
kairo:               routing state / pending correlation map / timeout 管理
```

### request のフロー

```
1. Router(B) が correlationId を生成
     形式は opaque（内部実装の詳細。UUID 等、一意性は router が保証）
2. Router(B) が ApiCall を送信（timeout 値を payload に含める。省略時はデフォルト 20 tick）
3. kairo が ApiCall を受信 ← この時点を call 開始点とする（MUST）:
     callerKairoId = ScriptEvent 送信元から確定（payload からは取得しない）
     [routing snapshot] 対象 addon の activation state を確認。active でなければ pending に追加せず即 ADDON_NOT_FOUND / ADDON_INACTIVE / ADDON_UNRESOLVED を返す
     [hook snapshot] hook providers の activation state を確認し、当該 call に参加する hook 一覧を確定する
     ※ step 3 以降の activation state 変化（target addon・hook providers いずれも）は当該 call に影響しない
     pending map に追加: { correlationId, callerKairoId, targetKairoId, deadlineTick }
     hook テーブルの sequence number は Registration phase finalized 時に addonId 辞書順で確定済み
4. kairo が hook before を実行
5. kairo が ApiInvoke を Router(A) に送信
6. Router(A) がハンドラを実行し ApiHandlerResponse を返す
7. kairo が hook after を実行
8. kairo が pending map から correlationId を削除  ← 削除を先に行う（リーク耐性）
9. kairo が ApiResult を Router(B) に送信

timeout 到達時（kairo が deadlineTick を超えたことを検出）:
  → kairo が pending map から correlationId を削除
  → kairo が Router(B) に ApiResult を送信: { success: false, errorType: "TIMEOUT" }
  → 後から ApiHandlerResponse が届いても kairo は破棄する（pending にないため）
  → Router(B) は ApiResult を受け取り RequestTimeoutError で reject する
```

**timeout はハンドラの実行を中断しない。**
kairo が timeout を検出してもハンドラは実行を継続する。ハンドラが応答を返しても kairo は pending から correlationId が消えているため破棄する。

**Router 側の安全タイムアウト（実装上の注意）**
kairo がタイムアウトの主管理者であり、Router は `ApiResult` を受動的に待つだけでよい。
ただし ScriptEvent の配送漏れや kairo 側のバグで `ApiResult` が届かない場合、Router の pending Promise が永久に残りメモリリークになる。
実装時は `timeout + 5 tick` 相当の保険的クリーンアップを Router 側に持つことを推奨する（SHOULD）。
このクリーンアップは pending を静かに削除するだけであり、新たな reject は行わない（すでに kairo からの TIMEOUT reject が届いているか、まだ届いていないかは問わず削除のみ）。

### deactivate race condition

```
call 開始点（step 3: ApiCall 受信時点）が routing target・hook providers 両方の状態確定基準点（MUST）。

  call 開始前 deactivate（step 3 より前に deactivate 完了）:
    → step 3 の routing チェックで検出（ADDON_INACTIVE / ADDON_UNRESOLVED を返す）
    → pending に追加されずに弾かれる

  call 開始後 deactivate（step 3 以降）:
    → target addon・hook providers いずれが deactivate しても当該 call には影響しない
    → invoke・handler・after hook・ApiResult 送信は通常通り実行される
    → deactivate は次回 routing チェックから inactive 扱いになるのみ

commit point の定義（ハンドラ応答の整合性検証・timeout collision 処理のため）:
  以下がすべて成立した時点を「結果確定（committed）」とする:
    1. ApiHandlerResponse のスキーマ検証が成功している
    2. sender kairoId が pending.targetKairoId と一致している
    3. correlationId が pending map に存在している
  commit point 到達時: pending.committed = true にセット（MUST）。
  commit point 以降は after hook と ApiResult 送信を続行する。

  timeout が commit 前に到達: pending 削除 → TIMEOUT を返す。後から届いた ApiHandlerResponse は破棄（pending なし）
  timeout が commit 後に到達: TimeoutScheduler は pending.committed を確認し（MUST）、true の場合 timeout を無視する。
    pending は step 8 で削除されるため、commit 後から pending 削除までの間に timeout が届いても pending.committed=true により無効化される。
  deactivate は call 開始点（step 3）以降は当該 call に影響しないため commit point による deactivate 判定は不要。
```

---

---

## 運用ガイドライン

### hook provider の lifecycle 責任

hook を登録するアドオンは、対象 API を提供するアドオンの lifecycle を考慮する責任を持つ。

- hook resolution は Registration finalized 時点で immutable のため、対象アドオンが UNRESOLVED であっても hook table には残る
- 対象アドオンが inactive の場合、hook chain 開始時の snapshot に含まれず実行されない（activation state の確認は call 開始時のみ）
- hook author は「対象アドオンが存在しない状態」「inactive な状態」を許容した hook を書くこと
- 対象アドオンへの依存が必須の場合は `dependencies` に宣言することを検討すること

### after hook での副作用制限（重要）

`after` hook は rollback 不可能なフェーズである。after hook が例外をスローすると result は破棄されるが、それ以前の after hook による外部副作用は取り消せない（distributed system における partial failure）。

**after hook は外部から観測可能な副作用を実行してはならない**（database write・ネットワーク送信・ファイル書き込み等）。after hook は result の純粋な変換処理のみを行うべきである（pure transform only）。kairo はこの規約を runtime では強制しないが、違反した場合の動作は保証されない（after throw による result 破棄・partial side effect 等が起きる可能性がある）。

```typescript
// 危険（MUST NOT）
after: async (ctx) => {
    ctx.result.balance -= 100;
    await database.commit();  // ← caller が AfterHookExecutionError を受けても commit は残る
}

// 安全
after: async (ctx) => {
    ctx.result = { ...ctx.result, taxApplied: true };  // pure transform のみ
}
```

- 外部副作用を伴う処理はハンドラ内部で完結させること（MUST）。
- ロギング・メトリクス等の観測系処理は after hook 内部で try/catch すること（MUST）。あるいは kairo 本体 hook（after throw が非 fatal）で処理することを検討する。
- after hook が rollback 不可能であることを常に意識すること。

### API 名の名前空間

API 名にスラッシュ区切りの名前空間を付けることを推奨する。同一 addonId 内の衝突を防ぐだけでなく、
hook 時の検索性が上がる。

```typescript
// 推奨
ev.api.register("economy/getBalance", handler);
ev.api.register("economy/deposit", handler);
ev.api.register("player/getInfo", handler);

// 非推奨（将来の名前衝突リスク）
ev.api.register("getBalance", handler);
```

---

## 未確定事項

現時点でなし。

---

## 設計方針メモ

- **ライブラリ非依存（public API）**: `router.register` / `router.hook` / `router.send` / `router.request` などユーザー向け API は外部ライブラリに依存しない。型安全はコンパイル時ジェネリクスのみ。
- **TypeBox 使用可能（internal）**: kairo 内部のプロトコルスキーマ定義は TypeBox を使用してよい。ユーザーには不可視。
- **addonId アドレッシング**: 呼び出し先は addonId で指定。kairoId は内部識別子のためユーザーに露出しない。callerKairoId は payload に含めず kairo が ScriptEvent 送信元から確定する（spoofing 防止）。
- **startup declaration**: `ev.api.register()` / `ev.api.hook()` は `router.beforeEvents.startup` コールバック内でのみ有効。`ev.api` は startup 終了後に seal される。handler は activation 後に使用可能になる。
- **hook の実行順序**: priority 数値昇順（任意の整数、省略時 0）。同値は addonId 辞書順（Registration phase finalized 時に kairo が採番）。after はオニオンモデル（before の逆順）。send に after フェーズはない。
- **責務分担**: router は ApiCall 送信・ApiResult 受信のみ。timeout / pending / routing は kairo が一元管理。pending 削除は ApiResult 送信より先に行う（リーク耐性）。
- **timeout はハンドラを止めない**: kairo が timeout を検出しても handler は実行を継続する。timeout 後に届いた ApiHandlerResponse は kairo が破棄する（pending にないため）。
- **send は ApiInvoke 送信で完了**: before hook 実行 → ApiInvoke 送信時点でパイプライン完了。handler response は不要（MUST NOT 送信）。watchdog・pending・timeout は存在しない。caller はパイプラインを観測できない。
- **send のエラーは caller に伝播しない**: hook/handler の例外は kairo が内部ログに出力する（SHOULD）。caller には何も返らない。
- **cancel は rollback を起動しない**: cancel は正常な short-circuit であり、before hook の rollback を起動しない。cancel 時の副作用 cleanup は hook author の責任。
- **hook chain の call-scoped snapshot（MUST）**: hook chain 開始時に activation state を一度だけ確認し、active な hook の一覧を確定する。以降は activation state を参照しない（MUST NOT）。snapshot 後の deactivate は当該 call に影響しない。
- **after の args は readonly by convention**: freeze なし。after での args 改ざんは undefined behavior（shallow でも deep でも）。部分的な freeze は誤った安全感を与えるため採用しない。
- **`after` hook throw → AfterHookExecutionError**: addon の after 例外でハンドラの result は破棄される。すでに実行済みの after は差し戻し不可（rollback なし）。kairo 本体 hook の after throw は非 fatal（内部キャッチ）。before throw は `BEFORE_HOOK_EXECUTION`（rollback あり）、after throw は `AFTER_HOOK_EXECUTION` で wire 上も区別可能。
- **after hook は pure transform only（guideline）**: after は rollback 不可能なため、外部副作用は保証できない。kairo は runtime で強制しないが違反時の動作は保証されない（after throw → result 破棄 + 副作用残留）。副作用はハンドラ内部に置くこと。
- **hook throw → rollback**: before hook 例外発生時は handler を実行せず、成功済み before に対応する `rollback` を逆順で実行する（`after` ではない。result が存在しないため）。rollback は best-effort（rollback 内で throw → ログのみ、続行）。rollback author は `setRollbackData()` で記録したデータを使う。kairo による自動 deep clone は行わない。
- **`ctx.cancel(result?)` の原子性**: result の設定と cancel は 1 回の呼び出しで行う。cancel 呼び出し時点の result が最終値となる。
- **call 開始点（step 3）以降の deactivate は無視**: routing target・hook providers いずれの deactivate も step 3 以降は当該 call に影響しない。deactivate は次回 routing チェックから有効。commit point はハンドラ応答の整合性検証と timeout collision 処理のためにのみ使用する（deactivate 判定には使わない）。
- **sequence number は addonId 辞書順**: Registration phase finalized 時点で採番。ScriptEvent 到着順に依存しない。
- **`conflicts` 宣言**: ACTIVATION_SPEC.md に記載済み。API hook とは別レイヤー（lifecycle レベル）の機能。

---

---

## 実装アーキテクチャ

### モジュール構成（kairo 側）

```
Entry Points（ScriptEvent 受信）
  ApiCallReceiver          ← ScriptEvent(ApiCall) → validates → Coordinator
  ResponseReceiver         ← ScriptEvent(ApiHandlerResponse) → validates → Coordinator

Coordination
  ApiPipelineCoordinator   ← routing / dispatch のみ（呼び出し受付・snapshot 取得・executor 生成）
    ↓
  CallLifecycleManager     ← per-call リソース（executor・pending・timeout）の lifecycle 管理
    ・per-call で Executor を生成・所有・破棄
    ・ResponseReceiver からの resume を受け取る
    ・TimeoutScheduler イベントに応答
    ・PendingRequestStore の create / remove を主導
    ・TrackingState 管理

Execution
  ApiPipelineExecutor      ← resumable state machine（mode はコンストラクタで固定）
    executeUntilInvoke()   → Invoke 状態で suspend
    resumeFromInvoke(res)  → After 以降を継続（send なら即 Completed）
    │
    ├─ HookPhaseRunner     ← ソート・フィルタ済みの chain を受け取り実行するだけ
    └─ RollbackExecutor    ← stack を所有（push / execute / clear）

Infrastructure
  PendingRequestStore      ← correlationId → pending entry（create / get / markCommitted / remove）
  TimeoutScheduler         ← tick ベースイベント（request timeout のみ。send に timeout なし）
  CallSnapshotResolver     ← routing + hook snapshot を一括解決。ResolvedCallSnapshot を返す

Protocol
  ProtocolCodec            ← TypeBox parse / serialize
  InvokeSender             ← ApiInvoke 送信（fire-and-forget）
  ApiResultDispatcher      ← ApiResult 送信
```

**router 側（packages/kairo-router）**

```
  ApiRegistry              ← register した handler 関数を保持
  HookRegistry             ← hook 関数 + metadata を保持
  ApiManifestBuilder       ← Registration 時の manifest 生成
  ApiCallSender            ← router.send() / router.request() 実装
  InvokeHandler            ← ApiInvoke 受信・handler 実行・ApiHandlerResponse 返送
```

---

### PipelineState

```typescript
// executor が持つ状態（TimedOut / Detached は含めない）
enum PipelineState {
  Before,      // before hook 実行中
  Invoke,      // handler 応答待ち（suspend 点）
  After,       // after hook 実行中
  Rollback,    // before throw 後の rollback 実行中
  Completed,   // 正常完了（cancel short-circuit を含む）
  Failed,      // 異常終了（before / after throw）
}
```

```
Before ──(all pass)──→ Invoke
Before ──(cancel)───→ Completed
Before ──(throw)────→ Rollback ──→ Failed

Invoke ──(response, request)──→ After
Invoke ──(response, send)────→ Completed

After ──(all pass)──→ Completed
After ──(throw)─────→ Failed
```

**TimedOut / Detached は pipeline の状態ではなく、Coordinator が保持する tracking state**。

```typescript
// Coordinator が request per-call エントリとして保持（send に TrackingState は不要）
enum TrackingState {
  Active,      // pipeline が Coordinator の管理下にある
  TimedOut,    // request timeout 到達（caller へ TIMEOUT 送信済み・pending 削除済み）
}
```

`TimedOut` 遷移時：pending エントリは削除済み。以降に到達した handler response は correlationId lookup に失敗し drop される。`resumeFromInvoke()` は呼ばれないため、**after hook は実行されない**。「timeout はハンドラを止めない」とは router 側の handler 実行を指し、kairo 側の after hook 実行を意味しない。

send には TrackingState が存在しない。send パイプラインは ApiInvoke 送信時点で Completed となり、Coordinator はリソースを即座に解放する。

---

### Pipeline Executor インターフェース

send と request はライフサイクルが異なるため別クラスに分離する。共通ロジック（before / rollback）は基底クラスに置く。

```typescript
// 共通ロジック（before hook 実行・rollback 管理）
abstract class BasePipelineExecutor {
  protected readonly rollback: RollbackExecutor;  // 自身が所有

  // before hook を実行し Invoke に必要な args を返す。
  // cancel: { kind: "completed"; result } を返す
  // throw:  BeforeHookExecutionError をスロー（rollback 実行済み）
  protected async runBefore(
    hooks: ResolvedHookChain,
    args: unknown,
  ): Promise<
    | { kind: "invoke"; modifiedArgs: unknown }
    | { kind: "completed"; result: unknown }
  >;

  readonly pipelineState: PipelineState;
}

// request 用（suspend → resume の 2 フェーズ）
class RequestPipelineExecutor extends BasePipelineExecutor {
  async executeUntilInvoke(
    hooks: ResolvedHookChain,
    args: unknown,
  ): Promise<
    | { kind: "suspended"; modifiedArgs: unknown }
    | { kind: "completed"; result: unknown }
  >;

  // handler response を受け取り after hook を実行して完了する。
  // 失敗は throw（AfterHookExecutionError）。
  async resumeFromInvoke(
    response: HandlerResponsePayload,
  ): Promise<{ kind: "completed"; result: unknown }>;
}

// send 用（before → invoke 送信で完了。suspend なし。response 不要）
class SendPipelineExecutor extends BasePipelineExecutor {
  async execute(
    hooks: ResolvedHookChain,
    args: unknown,
  ): Promise<void>;  // ApiInvoke 送信時点で resolve（response を待たない）
  // watchdog・onDetach は不要（pending もないため）
}
```

失敗は戻り値 object ではなく throw で表現する（仕様の exception model に合わせる）。`if (mode === "send")` 分岐は実装に存在しない。

---

### RollbackExecutor インターフェース

```typescript
class RollbackExecutor {
  // before hook 成功ごとに Executor が呼ぶ
  push(rollbackFn: RollbackFn, data: unknown): void;

  // before hook throw 時に Executor が呼ぶ（best-effort）
  async execute(currentArgs: unknown): Promise<void>;

  // 正常完了時に Executor が呼ぶ（stack を破棄）
  clear(): void;
}
// ApiPipelineExecutor が per-call でインスタンスを生成し所有する。
// 外部から stack への直接アクセス不可。
```

---

### PendingRequestStore インターフェース

```typescript
class PendingRequestStore {
  create(entry: PendingEntry): void;
  get(correlationId: string): PendingEntry | undefined;
  markCommitted(correlationId: string): void;  // commit point 到達時に Coordinator が呼ぶ
  remove(correlationId: string): void;
}

// commit point の判定は Coordinator が行う（Store は CRUD のみ）:
//   const entry = store.get(correlationId);
//   if (!entry || entry.targetKairoId !== senderId) { drop; return; }
//   store.markCommitted(correlationId);
//   // → executor.resumeFromInvoke(response)
```

---

### CallSnapshotResolver の責務

routing と hook の両 snapshot を step 3（call 開始点）で一括解決する。Coordinator が個別に RoutingResolver と HookChainResolver を呼ぶ構造を避け、orchestration の肥大化を防ぐ。

```typescript
class CallSnapshotResolver {
  resolve(
    targetAddonId: string,
    apiName: string,
    callerKairoId: string,
  ): ResolvedCallSnapshot | RoutingError;
}

type ResolvedCallSnapshot = {
  readonly targetKairoId: string;
  readonly hookChain: ResolvedHookChain;  // フィルタ・ソート済み・immutable
};

type ResolvedHookChain = {
  readonly before: ReadonlyArray<ResolvedHook>;   // priority asc + addonId 辞書順
  readonly after:  ReadonlyArray<ResolvedHook>;   // before の逆順
};
```

`HookPhaseRunner` は `for (const hook of chain.before)` するだけでよい。フィルタもソートも行わない。

---

### Coordinator の Executor lifecycle 所有

Coordinator は per-call で以下のリソースを所有し、明示的に破棄する責任を持つ。

```
Coordinator が所有するリソース（per-call）:
  ├─ ApiPipelineExecutor インスタンス
  ├─ PendingRequestStore のエントリ（request のみ）
  └─ TimeoutScheduler の登録（request: timeout / send: watchdog）

破棄タイミング:
  ・正常完了:   pending remove → timeout cancel → executor dereference
  ・timeout:    pending remove → TrackingState = TimedOut → executor dereference
               以降の handler response は pending lookup 失敗で drop（after 実行なし）
  ・send完了:  ApiInvoke 送信後即 executor dereference（watchdog 不要・pending 不要）

Coordinator は executor への reference を解放した後、
その executor からの通知を受け取ることはない（reference がないため）。
```

---

### 実装順序

```
1. ProtocolCodec
     TypeBox を使った ApiCall / ApiInvoke / ApiResult の parse・serialize。
     他のモジュールに依存しないため最初にテストできる。

2. RoutingResolver
     既存 activation logic を参照。addonId → kairoId の解決と activation check。

3. InvokeSender + ResponseReceiver（ScriptEvent 層）
     hook・pending なしで invoke → response roundtrip を単体で確認する。
     「request が届いて response が返る」最小経路を先に通す。

4. RollbackExecutor
     HookPhaseRunner より先に作る。後回しにすると HookPhaseRunner を壊す羽目になる。

5. HookChainResolver + HookPhaseRunner（before のみ）
     sorted・filtered chain を生成 → before 実行 → rollback 接続まで含めて確認。

6. BasePipelineExecutor + SendPipelineExecutor
     BasePipelineExecutor の before / rollback 共通ロジックを実装し、
     SendPipelineExecutor で send フローを確認する（pending・timeout・watchdog 不要）。
     send は invoke 送信で完了するため最もシンプルに確認できる。

6a. RequestPipelineExecutor
     suspend / resume 構造を追加。after hook 実行を含めて確認。

7. PendingRequestStore
     CRUD + markCommitted。request mode に必要になるタイミングで追加。

8. TimeoutScheduler
     tick ベースの timeout / watchdog。request timeout を ApiPipelineCoordinator に接続。

9. ApiPipelineCoordinator + request mode 対応
     Coordinator が resume・timeout・cleanup・TrackingState 管理を束ねる。
     send mode と request mode の差分はここで吸収。

10. ApiResultDispatcher + 全体結合
     ApiCallReceiver・ResponseReceiver と接続し、end-to-end を確認する。
```

**実装中に仕様へ戻る確率が高い箇所**:
- `rollbackData` の generic 化（`RollbackExecutor` 実装時に判断）
- hook snapshot のキャッシュ戦略（`HookChainResolver` のコストが問題になった時）
- startup callback 複数時の sequence 採番（`ApiManifestBuilder` 実装時に具体化）
