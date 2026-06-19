# Kairo Handoff 仕様

ステータス: **実装済み・仕様書起こし**

---

## 概要

kairo のバージョン切替は、通常の router アドオン（`executeVersionSwitch`）とは異なる独自の **Handoff プロトコル** で行われる。  
kairo はホスト状態（Activation Controller・API Pipeline・UI・セッション）を保持しているため、切替時にこれらを新バージョンへ**ライブ転送**する必要がある。

Handoff は同一ワールド内で同時起動している 2 つの kairo インスタンス間の **ScriptEvent 通信**で完結する。ワールドリロードは不要。

---

## 登場人物

| 役割 | 説明 |
|---|---|
| **Host（Orchestrator）** | 現在アクティブな kairo。Handoff を開始し、完了後に自分自身を破棄する |
| **Standby（Receiver）** | Election で負けた kairo。Handoff を受け取り、新しいホストになる |

---

## フェーズ全体図

```
Election 敗者
  ↓ onElectionLost()
  ↓ router.onceRegistered() で自分の kairoId 確定を待つ
  ↓
  ┌─────────────────────────────────┐
  │  Standby モード                  │
  │  ・StandbyReady ブロードキャスト  │
  │  ・HandoffReceiver をセットアップ │
  └─────────────────────────────────┘
         ↑ kairo:standby-ready を受信
         │
Election 勝者（Host）
  ↓ onInitComplete() 完了
  ↓ StandbyRegistry に記録
  ↓ (ユーザーが kairo:addons enable kairo [version] を実行)
  ↓
  ┌─────────────────────────────────┐
  │  Handoff 開始                    │
  │  ・apiPipeline.enterSwitchingMode│
  │  ・HandoffPayload 構築            │
  │  ・handoff-start 送信             │
  │  ・30 tick タイムアウト待機        │
  └─────────────────────────────────┘
         ↓ {targetKairoId}:handoff-start
  ┌─────────────────────────────────┐
  │  Standby 受信                    │
  │  ・ペイロードをデシリアライズ       │
  │  ・Registry/World 状態を復元      │
  │  ・ApiPipeline / EventPipeline   │
  │  ・isHost = true                 │
  │  ・kairo:handoff-done 送信        │
  └─────────────────────────────────┘
         ↓ kairo:handoff-done
  ┌─────────────────────────────────┐
  │  Host インフラ破棄               │
  │  ・isHost = false               │
  │  ・apiPipeline / eventPipeline  │
  │     / activationController      │
  │     / ui = undefined            │
  └─────────────────────────────────┘
```

---

## Standby フェーズ（Election 敗者側）

`onElectionLost()` が呼ばれると：

1. `router.onceRegistered()` で自分の `kairoId`（Discovery/Registration で確定）を待つ
2. `kairo:standby-ready` をブロードキャスト
   ```json
   { "kairoId": "kairo_xxxx", "version": { "ma": 1, "mi": 5, "p": 0 } }
   ```
3. `HandoffReceiver` をセットアップ → `{ownKairoId}:handoff-start` を待機

---

## Host 側：StandbyReady の受信

`kairo:standby-ready` リスナーは `init()` の**最初**（`KairoInitializer.setup()` より前）にセットアップされる。

- まだ `isHost` でない段階に届いたメッセージは `pendingStandbyMessages` にバッファリング
- `onInitComplete` 完了後にバッファをフラッシュ → `StandbyRegistry` に記録

`StandbyRegistry` は各スタンバイ kairo の `{ kairoId, version }` を保持し、後の switch で使う。

---

## コマンド：`kairo:addons enable kairo [version]`

`commandEnableKairo(versionStr?, player?)`:

| 状況 | 動作 |
|---|---|
| 指定バージョン（またはベストバージョン）が StandbyRegistry にある | `startVersionSwitch()` → ライブ切替 |
| StandbyRegistry にない（別バージョン・未起動など） | `saveKairoVersionPreference()` → セッションに保存し「次回リロード時に有効化」と通知 |

---

## ライブ切替：`HandoffOrchestrator.start(targetKairoId)`

1. `apiPipeline.enterSwitchingMode()` — 進行中の API 呼び出しを一時停止/キュー
2. `HandoffPayloadBuilder.build()` で現在の全状態をシリアライズ
3. `runtime.send("{targetKairoId}:handoff-start", JSON.stringify(payload))` 送信
4. **30 tick** タイムアウトを設定
5. `kairo:handoff-done` を待機
   - 受信 → `onComplete()` → ホストインフラ破棄
   - タイムアウト → `onFailed()` → `apiPipeline.exitSwitchingMode()` でロールバック

---

## Handoff ペイロード（`HandoffPayload`）

```typescript
{
    protocol: 1,                      // バージョン番号（Receiver 側で検証）
    registries: HandoffRegistryEntry[], // 全アドオンの Registry + APIマニフェスト情報
    runtimes: HandoffRuntimeEntry[],    // 各アドオンの状態 (ACTIVE/INACTIVE/UNRESOLVED + 理由)
    previousSession: Record<string, HandoffSessionEntry>, // セッションストア
    activationOrder: string[],          // アクティブ化の順序リスト
}
```

`HandoffRegistryEntry` には以下を含む：
- `kairoId`, `addonId`, `version`
- `name`, `description`, `metadata`
- `dependencies`, `optionalDependencies`, `tags`
- `manifest`: `apis[]`, `hooks[]`, `eventSubscriptions[]`

`HandoffSessionEntry`:
```typescript
{
    v: { ma, mi, p, pre? },   // バージョン（省略形）
    o: "explicit" | "latest",
    d?: true,                  // disabled フラグ
}
```

---

## Receiver 処理：`onHandoffReceived(payload)`

`HandoffReceiver` が `{ownKairoId}:handoff-start` を受信後、`onHandoffReceived` を**同期的に**実行：

1. `registryIndex.loadFromHandoff(payload.registries)` — レジストリ再構築
2. `ActivationController` を生成し `restoreFromHandoff(payload)` — World 状態を復元
   - `registries`, `runtimes`, `addonIdIndex`, `previousSession` を payload から再構成
   - `cachedDeclaredReverseGraph` を再計算
   - `activationOrder` を payload から引き継ぐ
3. `KairoApiPipeline` をセットアップ（`initialize()`）
4. `EventPipeline` をセットアップ
5. `ApiManifestController` で全マニフェストを処理
6. `KairoUI` を構築
7. `isHost = true`
8. `pendingStandbyMessages` をフラッシュ（自分より後に届いたスタンバイ通知を処理）
9. `saveSession(world.previousSession)` — 新ホストとしてセッションを保存

`onHandoffReceived` 完了後、`HandoffReceiver` が `kairo:handoff-done` を送信。

---

## セッション保存：`SessionStorage`

- キー: `_kairo_session`（`router.save()` 経由で kairo-database に永続化）
- 保存タイミング：
  - アクティブ化・非活性化のたびに（`onSessionChanged`）
  - Handoff 受信完了後（新ホストが `saveSession()` を呼ぶ）
  - ライブ切替不可時（`saveKairoVersionPreference()`）

---

## ScriptEvent まとめ

| ScriptEvent ID | 送信元 | 受信対象 | 内容 |
|---|---|---|---|
| `kairo:standby-ready` | Standby | Host (ブロードキャスト) | `{ kairoId, version }` |
| `{kairoId}:handoff-start` | Host | 特定の Standby | `HandoffPayload` (JSON) |
| `kairo:handoff-done` | Standby | Host (ブロードキャスト) | 空文字列 |

---

## タイムアウト定数

| 定数 | 値 | 意味 |
|---|---|---|
| `HANDOFF_DONE_TIMEOUT_TICKS` | 30 tick | handoff-done 待機上限。超えた場合は Host 側でロールバック |

---

## ライブ切替できないケース

StandbyRegistry にターゲットが存在しない場合（別バージョンがインストール済みだが Election 前に起動できていない等）：

- `saveKairoVersionPreference(kairoId, origin)` でセッションに記録
- 次回ワールドロード時、Election の勝者選出で preference を反映（`origin === "explicit"` 優先）

---

## 実装箇所

| ファイル | 役割 |
|---|---|
| `handoff/HandoffOrchestrator.ts` | Host 側 Handoff 開始・完了管理 |
| `handoff/HandoffPayloadBuilder.ts` | 全状態をシリアライズ |
| `handoff/HandoffPayload.ts` | ペイロード型定義 |
| `handoff/HandoffReceiver.ts` | Standby 側 Handoff 受信 |
| `handoff/HandoffEventId.ts` | ScriptEvent ID 定義 |
| `handoff/StandbyRegistry.ts` | 利用可能な Standby インスタンスの管理 |
| `activation/ActivationController.ts` | `restoreFromHandoff()`, `saveKairoVersionPreference()` |
| `session/SessionStorage.ts` | セッションのシリアライズ・デシリアライズ |
| `kairo/Kairo.ts` | 全体のオーケストレーション（init, onElectionLost, onHandoffReceived, startVersionSwitch） |
