# Activation Phase Specification

> ステータス: 確定

---

## 責務分担

| コンポーネント | 責務 |
|---|---|
| **kairo本体** (packs/kairo) | 依存解決の全責務。起動順の決定。起動・停止要求の送信。依存関係エラーの責任。 |
| **kairo-router** (packages/kairo-router) | 起動要求・停止要求を受け取り、処理して結果を返すのみ。依存解決には関与しない。 |

---

## アドオンのプロパティ

| プロパティ | 説明 | 一意性 | 保証フェーズ |
|---|---|---|---|
| `kairoId` | ランタイム生成の一意ID | ワールド内で完全に一意 | Discoveryフェーズ |
| `addonId` | アドオンの識別子（重複あり） | 一意でない | — |
| `version` | addonId内のバージョン | addonId内で一意 | — |
| `addonId + version` | アドオンの完全識別子 | 組み合わせで一意 | Registrationフェーズ |

---

## フェーズ構成

```
[Resolution Phase]  全アドオンを分析し activationPlan（起動順リスト）を出力する
        ↓
[Activation Phase]  activationPlan に従い起動要求を送信し、成功したものを ACTIVE にする
```

初期化後のユーザーによる手動操作でも同じロジックを共有する（後述）。

---

## サービス境界設計

「algorithm と state mutation を混ぜない」が中心原則。

### サービス一覧

```
ResolutionService          ← orchestration のみ（ロジックを持たない）
 ├─ ReasonResetService     ← Resolution 開始時の reason リセット（1関数）
 ├─ GraphBuilder           ← dependencyGraph / reverseDependencyGraph 生成（純粋計算）
 ├─ CycleDetector          ← 循環検出、CycleResult を返す（純粋計算）
 ├─ DependencyResolver     ← dependency spec → KairoId 解決、runtime + graph を mutate
 ├─ ConflictResolver       ← addonId conflict → winner/loser 決定、runtime を mutate
 └─ ActivationPlanner      ← canActivate を閉じ込め、ActivationPlan を生成

ActivationService          ← orchestration のみ
 ├─ ActivationExecutor     ← router interaction のみ。runtime mutate しない
 ├─ OptionalActivator      ← optional 依存の起動（mini subgraph resolution 含む）
 └─ DeactivationExecutor   ← manual / cascade / timeout / version switch deactivation
```

### Ownership Matrix

| Service | runtime mutate | graph mutate | router call |
|---|---:|---:|---:|
| ResolutionService    | ❌ | ❌ | ❌ |
| GraphBuilder         | ❌ | ✅ | ❌ |
| CycleDetector        | ❌ | ❌ | ❌ |
| DependencyResolver   | ✅ | ✅ | ❌ |
| ConflictResolver     | ✅ | ❌ | ❌ |
| ActivationPlanner    | ❌ | ❌ | ❌ |
| ActivationExecutor   | ❌ | ❌ | ✅ |
| OptionalActivator    | ✅ | ❌ | ✅ |
| DeactivationExecutor | ✅ | ❌ | ✅ |

### class vs stateless module

**class（constructor injection）**

| | 理由 |
|---|---|
| `ResolutionService` | sub-module を compose、DI で差し替え可能にする |
| `ActivationService` | executor 群と router を保持 |
| `ActivationExecutor` | router（KairoRuntime）を constructor で受け取る |
| `OptionalActivator` | ActivationExecutor を constructor で受け取る |
| `DeactivationExecutor` | router を constructor で受け取る |

**stateless module（純粋関数 or context を引数で受け取る関数）**

| | 備考 |
|---|---|
| `ReasonResetService` | `resetReasons(runtime)` 1関数で十分 |
| `GraphBuilder` | 純粋計算、unit test が容易 |
| `CycleDetector` | 純粋計算、`CycleResult` を返す |
| `DependencyResolver` | `ResolutionContext` を受け取り mutate |
| `ConflictResolver` | `ResolutionContext` を受け取り mutate |
| `ActivationPlanner` | `canActivate` を内部に閉じ込めた plan 生成 |

### 依存方向

```
ResolutionService
    │ (produces)
    ▼
ActivationPlan
    │ (input)
    ▼
ActivationService
    │ (delegates)
    ▼
Executor layer（ActivationExecutor / OptionalActivator / DeactivationExecutor）
    │ (calls)
    ▼
KairoRuntime（router）
```

---

## Service Interface 定義

### mutation ownership の原則

- **`ActivationExecutor`** は runtime を mutate しない。`ActivationOutcome` を返し、`ActivationService` が mutate する
- **`OptionalActivator`** も runtime を mutate しない。`Map<KairoId, ActivationOutcome>` を返し、`ActivationService` が全 outcome を適用する。activation success/failure ロジックが一系統になる。
- **`DeactivationExecutor`** は `boolean` を返し、呼び出し元（ActivationService）が abort/mutate を決定する
- **mutation ロジックは `applyActivationOutcome` に集約する。`ActivationService` と `OptionalActivator` の両方がこれを呼ぶ**
- **`ADDON_ID_CONFLICT` は state ではなく reason により表現する。conflict resolution は state を変更しない**

---

### ResolutionService

```typescript
export interface ResolutionService {
  resolve(
    world: KairoWorldState,
    scope: ReadonlySet<KairoId>,  // world-wide: all KairoIds / manual: dependency closure scope
  ): ActivationPlan;
}
// scope は membership 判定専用。runtime の取得は world.runtimes.get(kairoId) に統一する。
```

### ReasonResetService

```typescript
export function resetReasons(
  runtimes: Iterable<AddonRuntimeState>,
): void;
```

### GraphBuilder

pure。registry spec から **未解決の宣言グラフ**（`DeclaredDependencyGraph`）を生成する。KairoId への解決は DependencyResolver が行う。

```typescript
export type DeclaredDependencyGraph =
  ReadonlyMap<KairoId, ReadonlySet<AddonDependencySpec>>;

export function buildDeclaredGraph(
  registries: Iterable<KairoRegistry>,
): DeclaredDependencyGraph;
```

### CycleDetector

```typescript
export type CycleResult = {
  readonly cyclicNodes: ReadonlySet<KairoId>;
};

export function detectCycles(
  graph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>,
): CycleResult;
```

### DependencyResolver

`dependencyGraph` / `reverseDependencyGraph` / runtime を mutate する。context を受け取ることで graph mutation owner であることを明示する。

```typescript
export interface DependencyResolver {
  resolve(ctx: ResolutionContext): void;
}
```

### ConflictResolver

runtime（`ADDON_ID_CONFLICT` reason）を mutate する。DependencyResolver と対称。

```typescript
export interface ConflictResolver {
  resolve(ctx: ResolutionContext): void;
}
```

### ActivationPlanner

conflict や previous session は Step 5・6 で解決済み。planner は `canActivate` の iterative expansion のため scope と runtimes（scope 外 ACTIVE 依存確認用）の両方が必要。

```typescript
export interface ActivationPlanner {
  buildPlan(
    scope:           ReadonlyMap<KairoId, AddonRuntimeState>,
    runtimes:        ReadonlyMap<KairoId, AddonRuntimeState>,
    dependencyGraph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>,
  ): ActivationPlan;
}
```

### ActivationService

```typescript
export interface ActivationService {
  activate(
    world: KairoWorldState,
    plan:  ActivationPlan,
  ): Promise<void>;
}
```

### ActivationExecutor

router interaction のみ。runtime は mutate しない（ActivationService が `ActivationOutcome` を受け取って mutate）。

```typescript
export interface ActivationExecutor {
  activate(kairoId: KairoId): Promise<ActivationOutcome>;
}
```

### OptionalActivator

mini subgraph resolution を内部で実行し、全 addon の `ActivationOutcome` を `Map` で返す。**runtime mutation は自身では行わない**。呼び出し元（ActivationService）が各 outcome を `applyRuntimeTransition` / `markBlockedDependents` で適用する。

main plan の `ActivationContext.blockedKairoIds` は共有しない（誤 skip を防ぐ）。
`ActivationSession` 経由で共有するのは `optionalStack` のみ。

```typescript
export interface OptionalActivator {
  activateOptional(
    kairoId: KairoId,
    session: ActivationSession,  // optionalStack のみ共有
  ): Promise<Map<KairoId, ActivationOutcome>>;
}
// OptionalActivator は内部で mini subgraph Resolution を実行し ActivationPlan を生成してから
// ActivationExecutor を呼び出す。全 outcomes をまとめて返し、mutation は ActivationService が担う。
```

### applyRuntimeTransition（state machine mutation ヘルパー）

`runtime.state` と `runtime.reasons` の直接 mutation は禁止する。必ず以下の関数を経由すること。invariant を強制するためである。

```typescript
// ACTIVE への遷移（cleanup rule を適用して reasons をクリア）
export function setActive(runtime: AddonRuntimeState): void;

// INACTIVE への遷移（reason を追加）
export function setInactive(runtime: AddonRuntimeState, reason: InactiveReasonItem): void;

// UNRESOLVED への遷移（reason を追加）
export function setUnresolved(runtime: AddonRuntimeState, reason: UnresolvedReasonItem): void;
```

### markBlockedDependents（BFS 伝播ヘルパー）

失敗した addon の推移的依存元全てに `DEPENDENCY_INACTIVE` を付与し `blockedKairoIds` に追加する。
direct dependents だけでは不十分（A fail → B依存A → C依存B が全てブロックされない）。

```typescript
export function markBlockedDependents(
  failedKairoId:          KairoId,
  // Resolution 直後は plan.resolvedReverseDependencyGraph を渡す（正確）
  // cascade deactivate 等 Resolution 外では world.cachedDeclaredReverseGraph を渡す（近似）
  reverseGraph:           ReadonlyMap<KairoId, ReadonlySet<KairoId>>,
  runtimes:               ReadonlyMap<KairoId, AddonRuntimeState>,
  blockedKairoIds:        Set<KairoId>,
): void;
```

`ActivationService` が activation 失敗時（main plan・optional activation 両方の outcome 適用時）にこれを呼ぶ。
`ACTIVATION_FAILED` は成功時に `setActive` 内の cleanup で自動削除される（履歴は保持しない。意図的設計）。

**`blockedKairoIds` と `DEPENDENCY_INACTIVE` の役割の区別:**
- `blockedKairoIds`: Activation ループの実行最適化（skip 判定）。Activation 完了後に破棄される。
- `DEPENDENCY_INACTIVE` reason: 永続的な source of truth。次の Resolution まで残り、ユーザーへの状態表示に使われる。

### DependencyClosureBuilder（manual activate / optional activation 共用）

**registry dependency specs を再帰的に辿り** 到達可能な KairoId を返す。
addonIdIndex から全バージョンを追加するのではなく、**バージョン範囲にマッチする候補のみを追加する**（範囲外のバージョンで subgraph が不必要に肥大化するのを防ぐ）。

```typescript
export function buildDependencyClosure(
  targetKairoId:  KairoId,
  registries:     ReadonlyMap<KairoId, KairoRegistry>,
  addonIdIndex:   ReadonlyMap<AddonId, ReadonlySet<KairoId>>,
  versionMatcher: (spec: AddonDependencySpec, version: SemVer) => boolean,
): ReadonlySet<KairoId>;
// 各 dependency spec に対し versionMatcher を用いて候補を絞り込んでから再帰
```

### DeactivationExecutor

`boolean` を返すことで version switch 時の abort 判定を呼び出し元（ActivationService）に委ねる。

```typescript
export interface DeactivationExecutor {
  deactivate(kairoId: KairoId): Promise<boolean>;
}
```

---

## 内部状態モデル

### AddonState（永続フィールド）

```typescript
enum AddonState {
    ACTIVE     = "ACTIVE",
    INACTIVE   = "INACTIVE",
    UNRESOLVED = "UNRESOLVED",
}
```

`AddonState` は「現在状態」のみを表す。

### ActivationCandidate は存在しない

`candidate` という永続フィールドは持たない。「plan に乗るか否か」は Resolution Phase の Step 7 で `canActivate()` として都度計算し、`ActivationPlan` として出力する。アドオン自体には保存しない。

### registry と runtime state の分離

`KairoRegistry`（immutable な定義情報）と `AddonRuntimeState`（mutable な状態）は別々に管理する。

```typescript
// KairoWorldState: top-level container
type KairoWorldState = {
  readonly registries:   Map<KairoId, KairoRegistry>;     // immutable definitions
  readonly runtimes:     Map<KairoId, AddonRuntimeState>; // mutable state
  readonly addonIdIndex: Map<AddonId, Set<KairoId>>;
  previousSession:       PreviousSessionStore;            // ワールドをまたいで永続
  // registration/unregistration 時にのみ再構築。version switch でオンデマンド再構築しないためにキャッシュする
  // registry spec ベースの逆グラフ（registration/unregistration 時のみ再構築）
  // deactivate cascade・version switch で使用（過剰伝播は許容、false negative なし）
  cachedDeclaredReverseGraph?: ReadonlyMap<KairoId, ReadonlySet<KairoId>>;
};

// AddonRuntimeState: mutable state のみ（registry への参照を持たない）
type AddonRuntimeState = {
  readonly kairoId: KairoId;
  state:            AddonState;
  inactiveReasons:  InactiveReasons;
  unresolvedReasons: UnresolvedReasons;
  // Invariants:
  //   ACTIVE     → both maps empty
  //   INACTIVE   → unresolvedReasons empty
  //   UNRESOLVED → inactiveReasons empty
};
```

### 原因フォーマット（永続フィールド）

状態と原因は分離して管理する。同一コードの重複蓄積を防ぐため `Map<Code, Item>` で保持する。

```typescript
type InactiveReasonItem = {
  readonly code:     InactiveReasonCode;
  readonly message:  string;
  readonly related?: readonly string[];
};
type InactiveReasons = Map<InactiveReasonCode, InactiveReasonItem>;

enum InactiveReasonCode {
  // Runtime reasons（Resolution をまたいで保持）
  ACTIVATION_FAILED    = "ACTIVATION_FAILED",
  ACTIVATION_TIMEOUT   = "ACTIVATION_TIMEOUT",   // restart-block flag を兼ねる
  MANUALLY_DEACTIVATED = "MANUALLY_DEACTIVATED",
  CASCADE_DEACTIVATED  = "CASCADE_DEACTIVATED",
  // Resolution-generated reasons（Resolution 開始時にリセット）
  DEPENDENCY_INACTIVE  = "DEPENDENCY_INACTIVE",
  ADDON_ID_CONFLICT    = "ADDON_ID_CONFLICT",
  CONFLICTS_WITH       = "CONFLICTS_WITH",     // cross-addonId conflicts 宣言による競合
  PRERELEASE_ONLY      = "PRERELEASE_ONLY",
}

type UnresolvedReasonItem = {
  readonly code:     UnresolvedReasonCode;
  readonly message:  string;
  readonly related?: readonly string[];
};
type UnresolvedReasons = Map<UnresolvedReasonCode, UnresolvedReasonItem>;

enum UnresolvedReasonCode {
  // 全て resolution-generated（Resolution 開始時にリセット）
  DEPENDENCY_NOT_FOUND  = "DEPENDENCY_NOT_FOUND",
  DEPENDENCY_UNRESOLVED = "DEPENDENCY_UNRESOLVED",
  VERSION_NOT_SATISFIED = "VERSION_NOT_SATISFIED",
  CIRCULAR_DEPENDENCY   = "CIRCULAR_DEPENDENCY",
  PARSE_ERROR           = "PARSE_ERROR",
}
```

> **注意**: `UNRESOLVED` がセッション中に解消されないのは Minecraft の仕様上、ワールドを閉じずにアドオンの追加・更新ができないためであり、意図的な設計である。

### ActivationPlan

```typescript
type ActivationPlan = {
  readonly orderedKairoIds: readonly KairoId[];
  // Resolution が算出した解決済み逆グラフ。ActivationService が failure cascade に使う。
  readonly resolvedReverseDependencyGraph: ReadonlyMap<KairoId, ReadonlySet<KairoId>>;
};
```

### ResolutionContext（local）

```typescript
type ResolutionContext = {
  readonly scope:           ReadonlySet<KairoId>;                    // membership 判定のみ（runtime は runtimes から取得）
  readonly registries:      ReadonlyMap<KairoId, KairoRegistry>;
  readonly runtimes:        ReadonlyMap<KairoId, AddonRuntimeState>; // 全 runtime（scope 内外を含む）
  readonly addonIdIndex:    ReadonlyMap<AddonId, ReadonlySet<KairoId>>;
  readonly previousSession: PreviousSessionStore;

  // Step 1: registry spec から構築した未解決グラフ（DependencySpec のまま）
  declaredDependencyGraph: Map<KairoId, Set<AddonDependencySpec>>;

  // Step 3: 実 KairoId に解決済みのグラフ（DependencyResolver が構築、scope-local のみ）
  dependencyGraph: Map<KairoId, Set<KairoId>>;
  // Step 3 で DependencyResolver が同時に構築する解決済み逆グラフ（scope-local）
  // Step 4 BFS と Activation failure cascade（Resolution 直後）に使用
  resolvedReverseDependencyGraph: Map<KairoId, Set<KairoId>>;
  unresolvedQueue:           KairoId[];
  conflictGroups:            Map<AddonId, Set<KairoId>>;         // 同一 addonId 競合グループ
  crossAddonConflictPairs:   Array<[KairoId, KairoId]>;          // conflicts 宣言由来の競合ペア
  activationPlan:            ActivationPlan;
};
```

### ActivationOutcome

```typescript
type ActivationOutcome =
  | { readonly type: "SUCCESS" }
  | { readonly type: "FAILED";  readonly reason?: string }
  | { readonly type: "TIMEOUT" };
```

### ActivationContext と ActivationSession（local）

トポロジカル順は Resolution Step 7 で確定済みのため、Activation は `orderedKairoIds` を順に実行するだけでよい。Kahn's の再実装は不要。

**OptionalActivator は main plan の `ActivationContext` を共有しない。**
optional activation ごとに新しい `ActivationContext` を生成する（main plan の `blockedKairoIds` を汚染しないため）。
`ActivationSession` 経由で共有するのは `optionalStack` のみ。

```typescript
// algorithm data（main plan 用）
type ActivationContext = {
  // 失敗した addon と、その dependents（DEPENDENCY_INACTIVE 対象）を蓄積
  // blockedKairoIds: 実行最適化（skip 判定）。DEPENDENCY_INACTIVE reason が source of truth。
  blockedKairoIds: Set<KairoId>;
  // results は不要（outcomes は OptionalActivator の返り値や ActivationExecutor の返り値で管理）
};

// execution lifetime（optional stack を閉じ込める）
type ActivationSession = {
  readonly plan:          ActivationPlan;
  readonly optionalStack: Set<AddonId>; // addonId ベース（同一addonId別versionもブロック）
  readonly context:       ActivationContext;
};
```

### canActivate predicate（Step 7 / manual activate で使用）

`dependencyGraph` は Step 3 でバージョン範囲解決済みのエッジのみ持つため、versionRange の再チェックは不要。
`ACTIVATION_FAILED` はブロックしない（次の Resolution で自動リトライ）。
`ACTIVATION_TIMEOUT` と `MANUALLY_DEACTIVATED` はブロック。
`CASCADE_DEACTIVATED` はブロックしない（システムによる連鎖であり、条件が戻れば自動復帰を許可する）。

```typescript
function canActivate(
  kairoId:               KairoId,
  // ACTIVE KairoIds ∪ KairoIds already committed to this plan
  // optional mini-planner では ACTIVE KairoIds を base として渡す
  availableDependencies: ReadonlySet<KairoId>,
  ctx:                   ResolutionContext,
): boolean {
  if (!ctx.scope.has(kairoId)) return false;
  const runtime = ctx.runtimes.get(kairoId);
  if (!runtime) return false;
  if (runtime.state !== AddonState.INACTIVE)                                  return false;
  if (runtime.inactiveReasons.has(InactiveReasonCode.ACTIVATION_TIMEOUT))    return false;
  if (runtime.inactiveReasons.has(InactiveReasonCode.ADDON_ID_CONFLICT))     return false;
  if (runtime.inactiveReasons.has(InactiveReasonCode.CONFLICTS_WITH))        return false;
  if (runtime.inactiveReasons.has(InactiveReasonCode.PRERELEASE_ONLY))       return false;
  if (runtime.inactiveReasons.has(InactiveReasonCode.MANUALLY_DEACTIVATED))  return false;
  // CASCADE_DEACTIVATED はブロックしない（条件が整えば自動復帰）
  // ACTIVATION_FAILED はブロックしない（次の Resolution で自動リトライ）

  for (const depKairoId of ctx.dependencyGraph.get(kairoId) ?? []) {
    if (!availableDependencies.has(depKairoId)) return false;
  }
  return true;
}
```

### reason の永続区分

reasons は「いつ生成されるか」によって2種類に分類する。

**Runtime reasons（永続・Resolution でリセットしない）**

| reason | 生成タイミング |
|---|---|
| ACTIVATION_FAILED | Activation Phase で失敗したとき |
| ACTIVATION_TIMEOUT | Activation Phase でタイムアウトしたとき |
| MANUALLY_DEACTIVATED | ユーザーが手動 deactivate したとき |
| CASCADE_DEACTIVATED | cascade deactivate されたとき |

**Resolution-generated reasons（Resolution 開始時にリセットする）**

| reason | 生成タイミング |
|---|---|
| PRERELEASE_ONLY | Resolution Step 3 |
| ADDON_ID_CONFLICT | Resolution Step 6 |
| CONFLICTS_WITH | Resolution Step 6 |
| DEPENDENCY_INACTIVE | Resolution Step 3 / Activation Phase |
| DEPENDENCY_NOT_FOUND | Resolution Step 3 |
| VERSION_NOT_SATISFIED | Resolution Step 3 |
| CIRCULAR_DEPENDENCY | Resolution Step 2 |
| DEPENDENCY_UNRESOLVED | Resolution Step 3・4 |
| PARSE_ERROR | Resolution Step 3 |

### Resolution 開始時の reason reset

**state を基準に処理する**（reason を見て state を変えるのではない）。

```
for each runtime in scope:

  if runtime.state == UNRESOLVED:
    runtime.state = INACTIVE          // state を先に戻す
    runtime.unresolvedReasons.clear() // その後 reasons をクリア

  // resolution-generated inactive reasons を削除
  remove PRERELEASE_ONLY from inactiveReasons
  remove ADDON_ID_CONFLICT from inactiveReasons
  remove CONFLICTS_WITH from inactiveReasons
  remove DEPENDENCY_INACTIVE from inactiveReasons

保持:
  ACTIVATION_FAILED
  ACTIVATION_TIMEOUT
  MANUALLY_DEACTIVATED
  CASCADE_DEACTIVATED
```

### Activation 成功時の reason cleanup

ACTIVE への遷移時に以下の reason を除去する：

```
remove: ACTIVATION_FAILED
remove: DEPENDENCY_INACTIVE
remove: CASCADE_DEACTIVATED
remove: MANUALLY_DEACTIVATED
// DO NOT remove: ACTIVATION_TIMEOUT（cleanup コマンドのみが除去する）
```

`ACTIVATION_TIMEOUT` を持つ addon は `canActivate` でブロックされるため `setActive` を経由できない。
したがって `setActive` が `ACTIVATION_TIMEOUT` を除去する必要はなく、除去しても意味がない。

---

## バージョン指定形式

`properties` に定義し、`KairoRegistry` 等に含める。npm ライクな独自記法。

### 記法一覧

| 記法 | 意味 |
|---|---|
| `1.0.0` / `=1.0.0` | 完全一致（`=` は省略可） |
| `^1.0.0` | npm 準拠のキャレット（詳細後述） |
| `1.0.x` | patch 任意 |
| `1.x` / `1` | minor・patch 任意（`1` は `1.x` と同値） |
| `1.0` | `1.0.x` と同値 |
| `*` | 任意のバージョン |
| `>=1.0.0` | 以上。`>`・`<=`・`<` も同様 |
| `A & B` | A かつ B（`&` は `\|` より優先） |
| `A \| B` | A または B |
| `(...)` | グループ化（最優先） |

### `^` の挙動（npm 準拠）

左端の非ゼロ部分を固定する：

| 指定 | 範囲 |
|---|---|
| `^1.2.3` | `>=1.2.3 <2.0.0` |
| `^0.2.3` | `>=0.2.3 <0.3.0` |
| `^0.0.3` | `>=0.0.3 <0.0.4` |

prerelease 指定時も同様（例: `^0.0.3-beta` → `>=0.0.3-beta <0.0.4`）。

### semver build の扱い

semver の build メタデータ（`+` 以降）は完全に無視する。

### prerelease の扱い

- `-` に続く任意のラベル（`-beta.0`, `-preview`, `-rc.1` 等）を prerelease 版と見なす
- **安定版を前提とした指定**（例: `^1.0.0`）では、prerelease を自動起動の対象に含めない
  - ただし比較は行い、「解決可能だが prerelease のみ」と判定 → `INACTIVE`（`PRERELEASE_ONLY`）
- **prerelease を前提とした指定**（例: `^1.0.0-beta.0`）では prerelease を含む
- `*` は prerelease を含まない。安定版が存在しない場合のみ prerelease を含む

### 「解決可能」の定義

- **解決可能**: 安定版・prerelease 両方を考慮して、バージョン範囲を満たすものが1つ以上存在する
- **安定版で解決可能**: 上記のうち安定版（prerelease ラベルなし）のみで満たせる
- 解決可能だが安定版で解決できない → `INACTIVE`（`PRERELEASE_ONLY`）
- 解決不可能 → `UNRESOLVED`（`VERSION_NOT_SATISFIED`）

---

## 依存関係の種類

### dependencies（必須依存）

- 依存先がワールドに存在しない → `UNRESOLVED`（`DEPENDENCY_NOT_FOUND`）
- 依存先が `UNRESOLVED` → `UNRESOLVED`（`DEPENDENCY_UNRESOLVED`）
- 依存先が `INACTIVE` → 自身も `INACTIVE`（`DEPENDENCY_INACTIVE`）

### optional（任意依存）

- 依存先がワールドに存在しなくても → `UNRESOLVED` にならない
- optional は「利用可能なら使う」という宣言であり、起動の**要求ではない**
- **Resolution Phase の依存グラフ（トポロジカルソート）には含めない**
- optional の起動は activationPlan の外で行われる機会的（opportunistic）な起動である
- optional 依存先のバージョンが既に `ACTIVE` な同一 addonId と競合する場合 → 無視する
- optional 依存先が `UNRESOLVED` の場合 → 無視する
- optional の循環依存: `UNRESOLVED` にはしない（ユーザーの責任）
  - ただし循環に巻き込まれた optional 依存先は起動しない

### conflicts（競合宣言）

- `AddonProperties` および `KairoRegistry` の両方に `conflicts` フィールドを追加する
- `conflicts: { "other-addon": "^1.0.0" }` のように addonId とバージョン範囲で宣言する
- バージョン範囲は `dependencies` と同じ記法を使用する
- 宣言したアドオンと指定先アドオンは同時に `ACTIVE` にできない
- **初期 activation では両者とも `INACTIVE`**（自動選択なし。ユーザーが手動で選択する）
- `dependencies` と異なり「共存しない」という宣言であり、依存先不在でも起動は妨げない
- UI のアドオン詳細画面に競合相手の一覧を表示する

```typescript
// 例：b-manager が a-manager の置き換えとして宣言する
conflicts: { "a-manager": "*" }
// startup では a-manager も b-manager も INACTIVE（CONFLICTS_WITH）になる
// ユーザーが手動でどちらかを activate する
```

### ~~peer~~（削除済み）

---

## 循環依存の扱い（dependencies のみ）

| パターン | 結果 |
|---|---|
| A → A（自己依存、同一 addonId） | A が `UNRESOLVED` |
| A → B, B → A | A, B ともに `UNRESOLVED` |
| A → B, B → C, C → A | A, B, C ともに `UNRESOLVED` |
| optional の循環 | `UNRESOLVED` にしない（ユーザー責任）。循環に巻き込まれた optional 依存先は起動しない |

---

## Resolution Phase

### 入力 invariant

Resolution を実行する前に以下の invariant を保証すること：

```
同一 addonId を持つ ACTIVE なアドオンは最大1つ
```

バージョン切り替え操作など、複数の ACTIVE が生じうる操作の後に Resolution を呼ぶ場合は、事前に整合性を確認する。

### scope mutation invariant

**Resolution は scope 内のアドオンのみを mutate する。scope 外の runtime は読み取り専用とする。**

```
resetReasons(runtimes):
  対象 → scope.map(id => world.runtimes.get(id)) のみ

graph build / reason update / state transition:
  全て scope 内アドオンのみ

scope 外アドオン:
  参照のみ可（依存チェック等）
```

これを破ると manual activate の subgraph resolution が world 全体を汚染する。

### 入力

全登録アドオンの `KairoRegistry`（現在の state / reasons を含む）

### 出力

```typescript
activationPlan: ActivationPlan  // { orderedKairoIds: readonly KairoId[] }（Resolution 実行ごとに再生成）
```

`activationPlan` は Resolution の **ローカル出力**であり、アドオン自体には保存しない。

---

### Step 1: declared dependency graph build

`GraphBuilder.buildDeclaredGraph(registries)` を呼び、scope 内アドオンの `dependencies` を registry spec のまま保持した `declaredDependencyGraph` を構築する。状態変更なし。KairoId への解決は Step 3 で行う。

---

### Step 2: circular dependency detection

循環検出された addon:

```
state     = UNRESOLVED
reasons  += CIRCULAR_DEPENDENCY
```

---

### Step 3: dependency target resolution

`DependencyResolver` が `declaredDependencyGraph` の各 spec を実 KairoId に解決し、`dependencyGraph`/`reverseDependencyGraph` を構築する。解決失敗・prerelease 判定も本ステップで行う。

**dependency not found**
```
state     = UNRESOLVED
reasons  += DEPENDENCY_NOT_FOUND
```

**version unsatisfied**（prerelease も含めて解決不可）
```
state     = UNRESOLVED
reasons  += VERSION_NOT_SATISFIED
```

**dependency already UNRESOLVED**（Step 2 で検出済みのものへの依存）
```
if dependency.reasons has CIRCULAR_DEPENDENCY:
    skip（Step 4 BFS が伝播するため二重付与しない）
else:
    state     = UNRESOLVED
    reasons  += DEPENDENCY_UNRESOLVED
```

**prerelease only**（安定版が存在しない）
```
state     = INACTIVE
reasons  += PRERELEASE_ONLY
```

---

### Step 4: unresolved propagation

Step 2・3 で `UNRESOLVED` になった addon を起点に BFS で連鎖させる。
**新たに UNRESOLVED が発生しなくなるまで繰り返す。**

```
queue = { Step 2・3 で UNRESOLVED になった addon }

while queue is not empty:
  pop addon A
  // resolvedReverseDependencyGraph（scope-local）を使用。world.cachedDeclaredReverseGraph ではない。
  for each addon B in resolvedReverseDependencyGraph[A]:
    if !scope.has(B): continue   ← scope isolation（manual activate で world 外に波及させない）
    if B is already UNRESOLVED: continue
    B.state     = UNRESOLVED
    B.reasons  += DEPENDENCY_UNRESOLVED
    push B to queue
```

---

### Step 5: conflict detection（detect のみ）

責務: 競合グループを作る。状態・reasons は変更しない。

**[1] 同一 addonId 競合**
```
同一 addonId でグルーピング

group size == 1（競合なし）:
  do nothing

group size > 1（競合あり）:
  conflict group として Resolution ローカルに保存
```

**[2] cross-addonId 競合（conflicts 宣言）**
```
for each addon A in scope:
  for each (targetAddonId, versionRange) in A.registry.conflicts:
    candidates = scope 内の targetAddonId を持つ addon のうち
                 versionMatcher(versionRange, addon.version) == true のもの
    for each B in candidates:
      ctx.crossAddonConflictPairs.push([A, B])
      // 重複ペア (B, A) が既に追加されていても両側宣言として Step 6 で正しく処理される
```

---

### Step 6: conflict resolution（deterministic tiebreak）

責務: Step 5 で保存された conflict group および conflict pair を以下の優先順で解消する。

```
for each conflict group:

  // ACTIVE な addon が存在する場合の正規化
  activeInGroup = group の中で state == ACTIVE のもの
  if activeInGroup.length > 1:
    → invariant 違反。kairoId 辞書順で1つを残し、他は setInactive(CASCADE_DEACTIVATED)

  Priority 1: 前回セッションで明示的にバージョン指定していた addon が存在する
    → そのバージョンを winner とする
    → 既に ACTIVE な別バージョンが存在する場合は setInactive(CASCADE_DEACTIVATED) で落とす

  Priority 2: 前回セッションで "latest" 由来で起動していた addon が存在する
    → 現在の latest version（安定版優先、なければ prerelease 最新）を winner とする
    → 同様に古い ACTIVE を落とす

  Priority 3: 前回セッションデータなし（初回インストール等）
    → latest version を自動選択して winner とする

  Priority 4: 上記で解決できない場合（同バージョン重複など）
    → kairoId を辞書順でソートし、最初の1つを winner とする（常に deterministic）

  winner 以外（loser）:
    setInactive(ADDON_ID_CONFLICT) を呼ぶ
    （loser が ACTIVE だった場合も setInactive で確実に落とす）
```

**winner の state は変更しない**（INACTIVE のまま、activation plan で起動される）。
loser は `setInactive(ADDON_ID_CONFLICT)` により除外される。
conflict は `ADDON_ID_CONFLICT` reason によってのみ表現する。

**[2] cross-addonId conflict pair の解消**

初期 activation では自動選択を行わない。ユーザーが手動で選択する。
`CONFLICTS_WITH` reason の `related` フィールドに競合相手の addonId を格納する（UI 表示用）。

```
for each conflict pair (A, B):
  setInactive(A, { code: CONFLICTS_WITH, message: "...", related: [B.addonId] })
  setInactive(B, { code: CONFLICTS_WITH, message: "...", related: [A.addonId] })
  // 両者とも INACTIVE。activation plan には含めない。
  // ACTIVE だった場合も setInactive で確実に落とす。
  // 前回セッションで A が ACTIVE だったとしても、conflict 検出が優先される。
```

---

### Step 7: activation plan generation

以下の predicate `canActivate(addon, planCandidates)` で plan 対象を決定する：

```
canActivate(addon, planCandidates):
  addon.state == INACTIVE
  AND ACTIVATION_TIMEOUT not in reasons
  AND ADDON_ID_CONFLICT   not in reasons
  AND PRERELEASE_ONLY     not in reasons
  AND for all dep in addon.dependencies:
      dep.state == ACTIVE  OR  dep ∈ planCandidates
```

**ActivationPlanner 内部では Kahn's algorithm を使用する（O(V+E)）。** 「Activation Phase で Kahn's を再実装しない」方針はそのままで、ここでのみ Kahn's を使う。

```
1. canActivate を満たす addon を initial queue に追加
2. queue から取り出し plan に追加
3. その addon の dependents について in-degree を減算
4. in-degree が 0 になった dependents を queue に追加
5. queue が空になるまで繰り返す
```

初期 queue への追加・queue 内での priority は以下の順：
1. 前回セッションで明示バージョン指定していた addon
2. 前回セッションで latest 由来だった addon
3. それ以外

```typescript
// activationPlan 出力（KairoId のみ、KairoRegistry は含まない）
activationPlan: ActivationPlan  // { orderedKairoIds: readonly KairoId[] }
```

---

## Activation Phase

`activationPlan.orderedKairoIds` を順番に処理する。トポロジカル順は Step 7 で確定済みのため Kahn's を再実装しない。

```
for kairoId in activationPlan.orderedKairoIds:
  if context.blockedKairoIds.has(kairoId): skip
  outcome = activationExecutor.activate(kairoId)
  applyActivationOutcome(runtime, outcome, dependentRuntimes, context.blockedKairoIds)
```

### activation success

```
state:    INACTIVE → ACTIVE
reasons:  cleanup（前述の cleanup rule を適用）
blockedKairoIds: 変更なし
```

### activation failed

```
state:    INACTIVE（変更なし）
reasons: += ACTIVATION_FAILED

dependents:
  reasons += DEPENDENCY_INACTIVE
  blockedKairoIds.add(dependent)  ← 後続をまとめてスキップ
```

### activation timeout

```
state:    INACTIVE（変更なし）
reasons: += ACTIVATION_TIMEOUT   （restart blocked）
```

zombie 対応のため deactivation 要求を送信する（応答を待たない）。
dependents の扱いは activation failed と同様。

---

## optional 依存先の起動（plan 外・opportunistic）

optional の起動は activationPlan の外で行われる。実装上は `ManualActivate` と同等の mini subgraph resolution を実行する：

```
OptionalActivator.activateOptional(targetKairoId, session):
  0. 同一 addonId が既に ACTIVE な場合 → 即 skipped を返す（conflict を避ける early exit）
  1. buildDependencyClosure(target) で dependency closure を構築
  2. closure 内の【全ノード】について same addonId group を追加
     （target だけでなく closure 内の依存先も conflict 検出が必要）
  3. subgraph に対して Resolution を実行（Steps 1–7）
  4. ActivationPlan を生成
  5. plan を実行（applyActivationOutcome 経由で mutate）
  6. outcome を返す
```

これにより optional 依存先 B が自身の dependencies を持っていても正しく解決される。

無限再帰を防ぐため **`Set<addonId>` の activation stack** を維持する。kairoId でなく addonId を使うのは、同一 addonId の別バージョン（B@1 → B@2 等）もブロックするためである。

```
1. optional 依存先の addonId が activation stack にあれば → スキップ
2. なければ stack に追加して起動を試みる
3. 起動完了（成功・失敗問わず）後に stack から除去
```

optional 依存先の起動失敗は無視して自身の起動を続ける。

---

## Manual Activate

manual activate は **world-wide resolution を再実行しない**。
対象アドオンの依存閉包に限定したサブグラフ Resolution を実行する。

### サブグラフの範囲

```
subgraph =
  dependency closure of targetAddon（registry spec を再帰的に辿る。versionMatcher で範囲外を除外）
  + 全 closure ノードの same addonId グループ（addonId conflict 検出のため）
  + 各 same addonId グループの currently ACTIVE なバージョン（scope に含めることで mutate 許可とする）
  + targetAddon の conflicts 宣言に該当する ACTIVE なアドオン（scope に含めることで deactivate を許可）
```

conflicts 相手を scope に含めることで、手動 activate 時に競合相手が ACTIVE なままになる事態を防ぐ。
Step 6 の cross-addonId conflict 解消ロジックが競合相手を `setInactive(CONFLICTS_WITH)` できるようになる。

**scope に入れた addon は mutate してよい。** ACTIVE な競合バージョンを scope に明示的に含めることで、`setInactive(CASCADE_DEACTIVATED)` が scope isolation 違反にならない。

**dependency closure の定義**: `buildDependencyClosure()` が registry dependency specs を再帰的に辿り到達可能な全 KairoId を返す。manual activate 時点では `dependencyGraph`（Resolution Step 3 の出力）はまだ存在しないため、registry spec ベースで構築する。

### 処理フロー

```
activate(targetAddon):
  1. サブグラフ（dependency closure + 同一 addonId group + ACTIVE な競合バージョン）を構築
  2. サブグラフに対して Resolution を実行（Steps 1–7）
  3. 一時的な activationPlan を生成
  4. Activation Phase を実行
```

**重要: scope isolation の副作用**
scope 外のアドオン（subgraph に含まれなかったもの）は一切変更しない。
例えば scope 内の addon A が UNRESOLVED になっても、scope 外で A に依存している addon X はそのまま ACTIVE のままになる。これは仕様上の制約であり、意図的な設計である（manual activate は世界全体の依存を修復しない）。

---

## conflicts × Manual Activate

### 初期状態

startup activation で conflict が検出された場合、競合する両アドオンは `INACTIVE`（`CONFLICTS_WITH`）になる。
ユーザーが UI で明示的にどちらかを選択するまで両方 INACTIVE のまま。

### ユーザーがどちらかを手動 activate する場合

**ケース 1: A を activate（B は INACTIVE）**
```
通常の manual activate フローを実行。
B は INACTIVE（CONFLICTS_WITH）のまま変化しない。
```

**ケース 2: A が ACTIVE の状態で B を activate しようとした場合**
```
UI: B の Apply フォームで確認ダイアログを表示
  「B は [A] と競合しています。有効化すると [A] は無効になります。続けますか？」

ユーザーがキャンセル → 何もしない

ユーザーが確認 →
  1. A を deactivate（CASCADE_DEACTIVATED）
  2. A に依存するアドオンを cascade deactivate（通常の cascade deactivate と同様）
  3. B の subgraph resolution → activation 実行
```

### conflicts 解消後の再 activate

A を deactivate して B を activate した後、ユーザーが再度 A を activate したい場合は通常の manual activate フローが使用できる（CONFLICTS_WITH は Resolution 開始時にリセットされ、再評価される）。

---

## Deactivate

**Manual deactivate:**
```
ACTIVE → INACTIVE
reasons += MANUALLY_DEACTIVATED
```

**Cascade deactivate:**
```
ACTIVE → INACTIVE
reasons += CASCADE_DEACTIVATED
```

`dependencies` のみカスケードする。`optional` はカスケードしない（「なくても動く」宣言のため）。
カスケード deactivate 後は**自動再解決しない**。ユーザーが手動で再起動する。

---

## Cleanup（Timeout Recovery）

`ACTIVATION_TIMEOUT` を持つ addon はユーザーが明示的に cleanup を実行するまで restart blocked となる。

cleanup 実行時:
```
assert runtime.state != ACTIVE  // invariant: ACTIVE addon に ACTIVATION_TIMEOUT は存在しないはず
1. deactivation 要求を送信（応答を待たない）
2. ACTIVATION_TIMEOUT reason を除去
   （ACTIVATION_TIMEOUT 自体が restart-block flag を兼ねるため、これで十分）
```

cleanup は state を変更しない。cleanup 後に再起動したい場合は manual activate の通常フローを踏む。

---

## バージョン切り替え操作

UI 上、同一 `addonId` のアドオンはバージョン一覧を持つ1つのアドオンとして表示される。
「同一 addonId は同時に1つしか ACTIVE にできない」制約を守るため、旧バージョンを落としてから新バージョンを起動する。ロールバックはない。

### 処理手順（旧バージョン A v1 → 新バージョン A v2）

**前提**: version switch は Resolution local state を持たないため、`world.cachedDeclaredReverseGraph` を使って依存元を辿る（registry spec ベースのため過剰伝播の可能性があるが許容する）。

```
1. 現在 ACTIVE なアドオンのうち A に依存しているものを列挙し再評価:
   - A v2 でバージョン制約を満たせる → 切り替え後も継続予定としてマーク
   - 満たせない          → cascade deactivate 対象としてマーク

2. cascade deactivate 対象を deactivate（CASCADE_DEACTIVATED）

3. A v1 を deactivate
   - deactivate 失敗 → switch を abort。A v1 を ACTIVE のまま維持し処理を中断する

4. A v2 を activate（通常の activation ロジックと同じ）
   - 成功 → 継続予定アドオンの依存参照を A v2 に切り替える
   - 失敗 → A は INACTIVE（ACTIVATION_FAILED）のまま
           cascade deactivate されたアドオンも deactivated のまま
           ユーザーが手動で対処する

5. 自動再活性化はしない
```

---

## 前回セッションの状態保存と優先復元

前回セッションでどのアドオンが有効化されていたかを永続化しておく。

### 基本ルール

- 前回セッションで `ACTIVE` だったアドオンは優先的に activation plan に加える（Step 6 tiebreaker）
- アンインストールされているアドオンのデータは**削除しない**（再インストール時に再利用）
- アンインストール済みアドオンの前回データは依存解決時に無視する

### バージョン選択の優先度

1. ユーザーが**明示的にバージョンを指定**して起動していた場合 → 前回バージョンを優先（prerelease でも）
2. **"latest"** 由来で起動されていた場合 → 今回も latest を選択（バージョンが変わっても構わない）

### latest の定義

- 安定版が存在する場合: 解決可能な安定版の最新
- 安定版が存在しない場合: prerelease の最新

### ユーザーが手動選択するときの UI

- 選択肢: `"latest version"` + ワールド内の解決可能なバージョンリスト
- デフォルト: `"latest version"`

---

## 前回セッション状態の永続化

- 将来: `kairo-database` アドオン内の `dynamicProperty` で保存
- 現時点: kairo 本体のインメモリに文字列として保持
