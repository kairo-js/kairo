# Pack Execution Order Probe Specification

> ステータス: 確定（検証待ち）

---

## 目的

Minecraft Bedrock ScriptAPI は behavior pack の stack index 順にスクリプトを実行する。
この実行順をランタイムで確定するため、kairo は Registration フェーズ完了後に 1 回の ping-pong プローブを実行する。

取得した `packExecutionOrder`（KairoId の配列）は pack stack index 順の客観的な記録であり、
カスタムコマンドのハンドラ委譲先の決定など、実行順に依存する機能で使用する。

> **検証が必要な前提**: 本フェーズの結果が Minecraft の pack stack index 順と実際に一致するかは、
> `tests/` フォルダの検証アドオンで確認する（本仕様の末尾「検証計画」参照）。

---

## フェーズ構成

```
[Registration Phase]   全アドオンの KairoId・registry を確定する
        ↓
[PackOrderProbe Phase] pack の実行順を 1 回の ping-pong で確定する
        ↓
[ApiRegister Phase]    API manifest を収集し、routing table を構築する
```

---

## フェーズ区分の根拠

PackOrderProbe は Registration result とは役割が根本的に異なるため、
完全に独立したフェーズ・ScriptEvent ID を持つ。

| | Registration result | Order pong |
|---|---|---|
| 目的 | identity / manifest の確定 | timing signal の収集 |
| payload | registry 情報・API manifest | kairoId のみ |
| 送信条件 | kairo からの request に応じて | kairo からの ping に即時応答 |
| 受信フェーズ（kairo 側） | Registration | PackOrderProbe |

---

## ScriptEvent ID

| 方向 | Event ID | payload |
|---|---|---|
| Kairo → 全 router (broadcast) | `kairo:order-ping` | なし（空文字） |
| Router → Kairo | `kairo:order-pong` | `{ kairoId: string }` |

---

## kairo 側の仕様

### InitPhase

```typescript
enum InitPhase {
    Bootstrap,
    Election,
    Discovery,
    Registration,
    PackOrderProbe,  // NEW
    ApiRegister,
    Completed,
    Disposed,
}
```

### PackOrderProbe フェーズの開始

Registration フェーズのタイムアウト完了直後に `kairo:order-ping` を broadcast する。
payload は不要（空文字）。

```
Registration timeout 完了
  → phase = PackOrderProbe
  → runtime.send("kairo:order-ping", "")
  → 5 tick 待機
```

### pong の収集

- `kairo:order-pong` を受信するたびに `packExecutionOrder` 配列の末尾に kairoId を追加する
- 同一 kairoId の重複受信は無視する（先着のみ有効）
- PackOrderProbe フェーズ以外で受信した `kairo:order-pong` は無視する

### フェーズの終了

5 tick 待機後に以下を行い、ApiRegister フェーズへ移行する。

```
Registration に成功した kairoId のうち、pong が届かなかったものを
packExecutionOrder の末尾に付加する（順序不定・アルファベット順）
```

### 格納先

```typescript
// KairoRegistryIndex に追加
setPackExecutionOrder(order: readonly string[]): void;
getPackExecutionOrder(): readonly string[];
```

---

## router 側の仕様

### 応答タイミング

Registration 完了後（`startRouterListener` 確立直後）に `kairo:order-ping` の一時リスナーを設定する。

```
handleRegistrationResult()
  → sendApiManifest()
  → complete()
    → onCompleted()  // KairoRouter.startRouterListener() 呼び出し
      → (ここで order-ping の一時リスナーを設定)
```

- `kairo:order-ping` を受信したら、自分の kairoId を payload に含めた `kairo:order-pong` を即座に送信する
- リスナーは **1 回限り**（送信後に自動解除）

### ペイロードスキーマ

```typescript
// kairo:order-pong の payload（内部プロトコル）
const OrderPongSchema = Type.Object({
    kairoId: Type.String(),
});
```

### Registration 失敗時

kairoId が未確定（Registration 失敗）の router は `kairo:order-pong` を送信しない。
`startRouterListener` が呼ばれないため、一時リスナーもセットされない。

---

## タイミング図

```
Tick T   : kairo が "kairo:order-ping" を broadcast
Tick T+1 : 全 router が ping を受信（pack 実行順に処理）→ 各 router が pong を送信
Tick T+2 : kairo が pong を受信（到着順 = pack 実行順）
...
Tick T+5 : PackOrderProbe タイムアウト → packExecutionOrder 確定
```

pack の実行順が保証されるならば、T+2 には全 pong が揃っているはず。
残り 3 tick は余裕バッファ。

---

## 検証計画

`tests/` フォルダに複数の独立したテストアドオンを配置し、以下を検証する。

### テストアドオン構成

- `tests/addon-a/` — 最初に pack として適用される想定
- `tests/addon-b/` — 2 番目
- `tests/addon-c/` — 3 番目

各アドオンは activation 後に自分の起動順（`packExecutionOrder` 内の自分の index）をログ出力する。

### 検証項目

| # | 検証内容 |
|---|---|
| 1 | `packExecutionOrder` の長さが登録済み router 数と一致するか |
| 2 | 各アドオンの index が Minecraft のパックスタック順と一致するか |
| 3 | ワールドを再起動しても順序が一貫しているか |
| 4 | アドオンを追加・削除して再起動したときに順序が正しく更新されるか |

### 判定方法

各アドオンが `world.sendMessage("[addon-x] packIndex=N")` を出力し、
コンソールログとパックスタック設定を目視で比較する。
