# Custom Command 仕様

ステータス: **確定・実装待ち**

---

## Minecraft の性質

- カスタムコマンドの識別子は `prefix:commandId` の形式で、グローバルに一意。
- 複数のパックが同じ `prefix:commandId` を登録しようとすると、**packExecutionOrder が最小のパック（最初に実行されたもの）だけが登録に成功**し、以降のパックは登録できない（無視される）。
- コマンド引数の型はコマンド入力時に Minecraft がチェックし、型不一致はコールバックに届かずブロックされる。

---

## 後方互換性ルール（確定）

**同じ `prefix:commandId` を持つコマンドは、バージョン間で構文を変えてはならない。**

```
a@v1 が /a:test <string> <int> を登録したなら、
a@v2 以降も /a:test の構文は <string> <int> のまま変えることは許されない。
```

### 構文互換性の比較対象

比較するのは Minecraft の実行時挙動に影響する以下の3点のみ。パラメータ名は含めない。

- **型**（Integer / Float / String / PlayerId 等）
- **順序**
- **mandatory / optional の区別**

```ts
// 互換（パラメータ名が違うだけ）
v1: /player teleport <target: string> <location: vec3>
v2: /player teleport <player: string> <location: vec3>  ← 互換性あり

// 非互換（型が違う）
v1: /player teleport <target: string> <location: vec3>
v2: /player teleport <target: int>    <location: vec3>  ← 互換性なし
```

また、同じ `prefix:commandId` を持つコマンドは、全パラメータが**シリアライズ可能な表現へ変換できなければならない**（将来の新 ParameterType 追加時に relay 不可能な型が混入することを防ぐ）。

構文を変える必要がある場合は、新しいコマンド名（`/a:test2` 等）を追加すること。

---

## 初期化フェーズ順序

```
startup          ← 各アドオンが ev.customCommandRegistry.registerCommand() でコマンドを登録する
                    ラッパーはこの時点でコマンド宣言を内部に蓄積する
  ↓
worldLoad
  ↓
Discovery
  ↓
Registration
  ↓
PackOrderProbe   ← packExecutionOrder を確定
  ↓
Command Manifest ← router が蓄積した宣言を kairo に送信・検証（本仕様）
  ↓
API Manifest     ← 既存の API 宣言収集フェーズ
  ↓
Activation
```

Command Manifest を API より先に置く理由：コマンドは startup 時点で登録済みであり activation 前から参照されるが、API は activation 後に使用されるため。

---

## Command Manifest フェーズ

### 目的

- 各アドオンが登録したコマンド宣言情報を kairo に集約する。
- packExecutionOrder を使い、同じ `prefix:commandId` を宣言した複数バージョンのうち、**実際に Minecraft へ登録されているのはどのバージョンか**を特定する。
- 異なるバージョン間でコマンドの構文が一致しているかを検証し、不一致があれば構文互換性エラーを報告する。

### kairo 側での解決ロジック

1. 全アドオンから Command Manifest を収集する。
2. 同じ `prefix:commandId` を宣言しているアドオンが複数ある場合、packExecutionOrder が最小のアドオンを**登録アドオン（command registrar）**として特定する。
3. 同じ `prefix:commandId` を宣言している他のバージョンと構文（型・順序・mandatory/optional）を比較する。
4. 不一致があれば構文互換性エラーとして報告する。

### description への登録アドオン情報付与

どのバージョンが実際にコマンドを Minecraft へ登録しているかをプレイヤーが識別できるよう、
ラッパーが startup 前に `description` 末尾へ `(addonId@version)` を付与してからネイティブへ渡す。
付与方法は実装詳細とする（`CustomCommand.description` の型に依存）。

```
例: "プレイヤーをテレポートする (my-addon@1.0.0)"
```

---

## ラッパー（router.startup）の役割

アドオンは `router.beforeEvents.startup` のラッパー経由でコマンドを登録する。
ラッパーはネイティブ `CustomCommandRegistry` への登録を行いつつ、コールバックをインターセプトする。

### active 時の挙動

アドオンが active の場合、コールバックをそのまま実行する（正常フロー）。

### inactive 時の挙動

アドオンが inactive の場合、**ローカルに保持している `delegatable` マップ**を同期的に参照して判断する。

```
inactive 時の判断フロー:
  1. delegatable.get(commandName) を確認する
       → false:
            { status: Failure, message: "<commandName> is not available." } を return
            ※ 理由（active バージョンなし / コマンド未登録）は区別せず統一メッセージにする
       → true（委譲可能）:
            引数をシリアライズして kairo へ ScriptEvent 送信
            { status: Success } を即 return
            ※ Success は「委譲受付成功」を意味する。コマンドが成功したことを保証しない。
```

### async による relay 突破は不可能（確定）

Minecraft のネイティブコマンドハンドラは同期関数（`CustomCommandResult | undefined`）。
Promise を return しても Minecraft は await しない。ScriptEvent の応答は次 tick 以降であり、
ハンドラの return より後にしか届かない。**async でこの制約を突破する手段は存在しない。**

---

## 委譲フロー（inactive アドオンのコマンドが実行された場合）

```
プレイヤーが /a:test arg1 arg2 を実行
  ↓
Minecraft が a@v1（packExecutionOrder 最小）のネイティブハンドラを呼ぶ
  ↓
ラッパーが isActive() を確認
  → active: ハンドラを直接実行（正常）
  → inactive: delegatable を参照 → 委譲可能なら kairo へ ScriptEvent 送信・{ status: Success } を即 return
  ↓
kairo が受信（{ addonId: "a", commandName: "a:test", args: [...] }）:
  1. addonId "a" の active なバージョンを特定する（必ず 1 個。後述）
  2. そのバージョンが Command Manifest にコマンドを登録しているか確認する
  3. 確認 OK なら active バージョンへ ScriptEvent で引数情報を転送する
  4. active バージョンがない、またはコマンド未登録なら無視する（SHOULD: ログ出力）
  ↓
a@v3 が受信:
  → ネイティブコマンドとは別ルート（ScriptEvent 経由）でハンドラを実行する
```

### active バージョンの一意性

同一 addonId に対して active なバージョンは **必ず 1 個**である。これは Activation フェーズで保証される。複数の active バージョンが同時に存在することはない。

---

## 引数のシリアライズと復元

Minecraft のコマンドコールバックには、型によってプリミティブではなくゲームオブジェクトが渡される場合がある。ScriptEvent で転送するために JSON シリアライズが必要なため、オブジェクト型は識別子に変換して送り、受け取り側が再取得する。

| パラメータ型 | コールバックに渡る値 | シリアライズ | 受け取り側での復元 |
|---|---|---|---|
| Integer / Float | `number` | そのまま | そのまま |
| Boolean | `boolean` | そのまま | そのまま |
| String / Enum | `string` | そのまま | そのまま |
| PlayerId | `Player` オブジェクト | `{ type: "player", id: player.id }` | `world.getAllPlayers().find(p => p.id === id)` |
| Entity 系 | `Entity` オブジェクト | `{ type: "entity", id: entity.id }` | `world.getEntity(id)` |
| Location / BlockLocation | `Vector3` | `{ type: "vec3", x, y, z }` | そのまま構築 |
| Block | `Block` オブジェクト | `{ type: "block", dimensionId, x, y, z }` | `world.getDimension(dimensionId).getBlock({x,y,z})` |

コマンド登録アドオン（v1）はコマンド登録時に各パラメータの型を把握しているため、受け取った args を型情報に基づいてシリアライズできる。受け取り側（v3）は同一構文を持つため、同じ型情報で復元できる。`CustomCommandOrigin`（コマンドの実行元情報）も同様に既存の serialize/reconstruct の仕組みを流用する。

### 復元失敗の許容

委譲は ScriptEvent を介するため、送信から受信まで**最低 1 tick の遅延**が発生する。その間にゲーム状態が変化した場合、復元が失敗し得る。

- **Player**: ログアウト等により `find()` が `undefined` を返す可能性がある。
- **Entity**: 死亡・チャンクアンロード等により `getEntity()` が `undefined` を返す可能性がある。
- **Block**: 破壊・置換等により `getBlock()` が `undefined` を返す可能性がある。

これらは**仕様上 accept する**。受け取り側のハンドラは、復元失敗（`undefined`）を考慮して実装しなければならない（MUST）。

---

## 構文互換性エラー時の挙動

- kairo は検出した不一致をログ出力する（MUST）。
- ゲームディレクター権限を持つプレイヤーへ警告メッセージを送信する。
- コマンド自体の動作は止めない（Minecraft への登録は packExecutionOrder 最小パックが行っており、kairo には止める手段がない）。

---

## ローカル状態の管理

### 対象：コマンド登録アドオン（command registrar）のみ

kairo がプッシュする情報を受け取る必要があるのは、**同じ `prefix:commandId` を持つグループの中で packExecutionOrder が最小のアドオン**（実際に Minecraft へコマンドを登録したアドオン）のみ。他のバージョンはこの情報を必要としない。

### kairo からのプッシュ内容

複雑な型情報をすべて渡すのではなく、**委譲可能かどうかの bool のみ**を渡す。kairo 内部では `Map<commandName, Map<kairoId, boolean>>` を保持してもよいが、push 先のルーターへ渡すのは解決済みの `Map<commandName, boolean>` だけで十分。

```typescript
// key は prefix:commandId 形式（例: "a:test"）
// value: true  = active なバージョンが存在し、かつ同一構文でコマンドを登録している
//        false = active なバージョンが存在しない、またはコマンド未登録
delegatable: Map<string, boolean>
```

**未初期化時（Command Manifest フェーズ完了前）の扱い**

Command Manifest フェーズ完了前（`delegatable` が未初期化の状態）にコマンドが実行された場合、activation フェーズすら始まっていないため、`false` として扱い `"<commandName> is not available."` を返す。

### kairo からのプッシュタイミング

- **Command Manifest フェーズ完了後**: 各コマンド登録アドオンへ初回の `delegatable` マップをプッシュする。
- **activation 状態変化時**: addonId `a` の activation が変化したとき（例: a@v2 → a@v3 に切り替わり）、`a` のコマンド登録アドオン（a@v1）にのみ更新をプッシュする。他の addonId（b, c 等）には通知しない。

---

## 実装側の決定事項（仕様の詳細化は不要）

以下は実装者が適切に設計する。仕様レベルでの制約はない。

- Command Manifest のスキーマ・ScriptEvent ID・フェーズのタイムアウト
- ローカル状態プッシュの ScriptEvent ID・スキーマ
- 委譲リクエスト・転送フォーマット（kairo → active バージョンへの転送）
- 構文比較アルゴリズム（パラメータ型の文字列表現の正規化など）
