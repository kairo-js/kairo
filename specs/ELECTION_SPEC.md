# Kairo Election 仕様

ステータス: **実装済み・仕様書起こし**

---

## 概要

複数バージョンの Kairo が同一ワールドに共存する場合、**ホスト（ActivationController / UI / コマンドハンドラを保持する側）は必ず 1 つ**でなければならない。Election フェーズはその 1 つを決定するプロトコルである。

Election は `packs/kairo` 固有のフェーズであり、ゲスト側の `kairo-router` は関与しない。

---

## 初期化フェーズ全体における位置づけ

```
worldLoad
  ↓
Bootstrap    ← セッションデータ取得（kairo-database から）
  ↓
Election     ← ★ 本仕様
  ↓  [勝者のみ続行]
Discovery
  ↓
Registration
  ...
```

Election に負けた Kairo は Standby モードへ移行し、ホストからの Handoff を待機する（後述）。

---

## Bootstrap フェーズ（Election の前提）

Election に先立ち、直前の実行セッションで保存されたデータを取得する。

1. `kairo:session-request` をブロードキャスト
2. kairo-database が `kairo:session-response` で応答（JSON または空文字）
3. **5 tick** 待機後 Bootstrap 終了 → Election 開始

セッションデータは「どのアドオンのどのバージョンが最後に active だったか」を記録したもの（後述の勝者選出に使用）。

---

## Election フェーズ

### Step 1: instanceId 生成

スコアボード `_kairo_election_iid` をレジストリとして使用し、衝突のない一意な instanceId（8桁ランダム hex）を生成・登録する。

- スコアボードが存在しない場合は新規作成する
- クラッシュした前セッションの残留スコアボードが存在する場合も `addObjective` をスキップして既存のものを使用する

### Step 2: 立候補ブロードキャスト

```
kairo:bootstrap-election-announce → { v: { ma, mi, p, pre? }, id: instanceId }
```

自分自身を含む全 Kairo インスタンスがこのイベントを受信する（ScriptEvent はブロードキャスト）。

### Step 3: 候補収集（10 tick 待機）

`handleElectionAnnounce` で受信した候補を `pendingElectionCandidates` に蓄積する。  
自分自身の announce も受信するため、通常は必ず 1 件以上入る。

エッジケース: 何も受信しなかった場合は自分自身を唯一の候補として扱う（フォールバック）。

### Step 4: 勝者選出

以下の優先順位で勝者を決定する。

| 優先順位 | 条件 | 詳細 |
|---|---|---|
| 1 | セッションに明示的な Kairo バージョン指定がある | `origin === "explicit"` かつ候補に一致するバージョンが存在する場合、そのバージョンを選ぶ |
| 2 | 最新の安定版（prerelease なし） | SemVer で最大のものを選ぶ |
| 3 | 安定版がない場合は最新の prerelease | 同上 |
| 同点 | instanceId で辞書順が小さい方 | 全インスタンスが同じ候補リストを見るため、決定的に同じ勝者を選出できる |

#### セッション優先の意味

`kairo:addons enable kairo 1.0.0` を実行すると、セッションに `kairo → { version: 1.0.0, origin: "explicit" }` が書き込まれる。次のワールドロード時、election は v1.0.0 を優先して選出する。v1.0.0 がインストールされていない場合は通常の最新版選択にフォールバックする。

### Step 5: 後処理

**勝者:**
1. スコアボード `_kairo_election_iid` を削除（クリーンアップ）
2. Discovery フェーズへ進む

**敗者:**
1. `onElectionLost()` を呼び出す
2. `KairoInitializer` を dispose（ホスト側の初期化を中断）
3. Standby モードへ移行（後述）

---

## 敗者の Standby モード

敗者は死ぬのではなく、次のホストとして呼び出される準備をする。

1. `router.onceRegistered()` で自身の kairoId が確定するまで待機
2. `HandoffEventId.StandbyReady` をブロードキャスト
   ```
   { kairoId: string, version: { ma, mi, p, pre? } }
   ```
3. `HandoffReceiver` をセットアップし、ホストからの Handoff を待機

ホスト（勝者）は `StandbyReady` を受信すると `StandbyRegistry` に登録し、`kairo:addons enable kairo <version>` コマンドや UI からの version switch リクエストに使用できるようにする。

---

## 通信まとめ

| ScriptEvent ID | 送信元 | 受信対象 | 内容 |
|---|---|---|---|
| `kairo:session-request` | 全 Kairo | kairo-database | セッション取得リクエスト |
| `kairo:session-response` | kairo-database | 全 Kairo | セッション JSON（または空文字） |
| `kairo:bootstrap-election-announce` | 各 Kairo | 全 Kairo | 立候補 `{ v, id }` |

---

## スコアボード使用

| スコアボード ID | 用途 | ライフサイクル |
|---|---|---|
| `_kairo_election_iid` | instanceId の衝突チェック用レジストリ | Election 開始時に作成、勝者が終了後に削除 |

---

## タイムアウト定数

| フェーズ | 定数名 | 値 |
|---|---|---|
| Bootstrap | `BOOTSTRAP_TIMEOUT_TICKS` | 5 tick |
| Election | `ELECTION_TIMEOUT_TICKS` | 10 tick |

---

## 実装箇所

- `packs/kairo/src/kairo/init/KairoInitializer.ts` — `startElection()`, `selectWinner()`, `handleElectionAnnounce()`
- `packs/kairo/src/kairo/Kairo.ts` — `onElectionLost` コールバック（Standby モード移行）
- `packs/kairo/src/kairo/handoff/StandbyRegistry.ts` — Standby エントリの管理
- `packs/kairo/src/kairo/handoff/HandoffReceiver.ts` — 敗者側の Handoff 受信
