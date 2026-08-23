# Factory Function 패턴 이해하기

## Factory Function이란?

**객체를 만들어서 반환하는 일반 함수**입니다.

`new` 키워드나 `class` 없이, 함수를 호출하면 객체가 나옵니다.

```typescript
function createCounter() {
  let count = 0

  function increment() { count++ }
  function getCount() { return count }

  return { increment, getCount }
}

const counter = createCounter()
counter.increment()
counter.getCount() // 1
```

"Factory(공장)"라는 이름은 말 그대로 **객체를 찍어내는 공장 함수**라는 뜻입니다.

---

## Class와 비교

같은 기능을 class로 만들면 이렇습니다:

```typescript
// Class 방식
class Counter {
  private count = 0

  increment() { this.count++ }
  getCount() { return this.count }
}

const counter = new Counter()
```

```typescript
// Factory Function 방식
function createCounter() {
  let count = 0

  function increment() { count++ }
  function getCount() { return count }

  return { increment, getCount }
}

const counter = createCounter()
```

| 관점 | Class | Factory Function |
|------|-------|------------------|
| 객체 생성 | `new Counter()` | `createCounter()` |
| private 구현 | `private` 키워드 | closure (외부에서 접근 불가) |
| `this` 사용 | 필수 | 없음 |
| 상속 | `extends`로 가능 | 직접 조합(composition) |
| 메모리 | 메서드가 prototype에 공유됨 | 객체마다 함수 복사본 생성 |

---

## 핵심 개념: Closure (클로저)

Factory function의 private이 동작하는 원리가 **closure**입니다.

```typescript
function createCounter() {
  let count = 0  // ← 이 변수는 함수 밖에서 절대 접근 불가

  return {
    increment() { count++ },  // ← 하지만 이 함수들은 count를 기억하고 있음
    getCount() { return count }
  }
}

const counter = createCounter()
counter.count      // undefined (접근 불가)
counter.getCount() // 0 (함수를 통해서만 접근 가능)
```

**Closure란**: 함수가 자신이 생성된 환경(변수들)을 기억하는 것.

`createCounter()`가 끝나도 `count` 변수는 사라지지 않습니다. `increment`와 `getCount`가 여전히 참조하고 있기 때문입니다. 이것이 `private` 키워드 없이도 캡슐화가 되는 이유입니다.

---

## 옵션 전달: Interface의 역할

Factory function에 설정을 넘길 때 interface로 옵션 형태를 정의합니다:

```typescript
// "이런 형태의 옵션을 받겠다"는 계약
interface CounterOptions {
  initialValue: number
  step: number
  onUpdate?: (value: number) => void  // 선택적 콜백
}

function createCounter(options: CounterOptions) {
  let count = options.initialValue

  function increment() {
    count += options.step
    options.onUpdate?.(count)  // 콜백이 있으면 호출
  }

  return { increment, getCount() { return count } }
}

// 사용
const counter = createCounter({
  initialValue: 0,
  step: 5,
  onUpdate: (val) => console.log(`현재 값: ${val}`)
})
```

여기서 interface는 class 설계를 위한 것이 아니라, **함수에 전달할 객체의 형태를 정의하는 용도**입니다. Java의 생성자 파라미터를 타입으로 명시한 것과 비슷합니다.

---

## 이 프로젝트에서의 실제 사용

### drawingMode.svelte.ts

```typescript
// 옵션 정의
interface DrawingModeOptions {
  getScope: () => paper.PaperScope | null
  getBrush: () => { color: string; width: number; opacity?: number }
  onPathCreated?: (path: paper.Path) => void
  onDrawStart?: () => void
  onDrawEnd?: () => void
}

// Factory function
function createDrawingMode(options: DrawingModeOptions) {
  // --- closure 영역 (외부 접근 불가) ---
  let isActive = $state(false)
  let isDrawing = $state(false)
  let currentPath: paper.Path | null = null

  function activate() { /* ... */ }
  function deactivate() { /* ... */ }

  // --- 외부에 공개할 것만 반환 ---
  return {
    get isActive() { return isActive },
    get isDrawing() { return isDrawing },
    activate,
    deactivate
  }
}
```

**구조를 그림으로 보면:**

```
createDrawingMode(options)
│
├── [closure - 외부 접근 불가] ──────────────────────┐
│   let isActive = $state(false)                     │
│   let isDrawing = $state(false)                    │
│   let currentPath = null                           │
│   let lastPoint = null                             │
│   let canvasElement = null                         │
│   let activePointerId = null                       │
│                                                    │
│   function finalizePath() { ... }                  │
│   function getProjectPoint(e) { ... }              │
├────────────────────────────────────────────────────┘
│
└── return { ─────────────────────── [외부 공개 API]
      get isActive(),    // 읽기 전용
      get isDrawing(),   // 읽기 전용
      activate(),        // 메서드
      deactivate(),      // 메서드
    }
```

### getter를 사용하는 이유

```typescript
// 이렇게 하면 안 됨 - 반환 시점의 값이 복사됨 (반응성 끊김)
return { isActive: isActive }

// 이렇게 해야 함 - 호출 시점마다 최신 값을 읽음
return { get isActive() { return isActive } }
```

`$state`로 선언된 변수는 getter로 감싸야 외부에서 읽을 때마다 최신 값을 반환합니다.

---

## 왜 Class가 아니라 Factory Function인가?

### 1. Svelte 5 Runes와의 호환성

`$state()`, `$derived()`, `$effect()`는 class 내부에서 제약이 있습니다:

```typescript
// 문제 있음 - $state가 class field에서 제한적
class DrawingMode {
  isActive = $state(false)  // 동작하지만 제약 있음
}

// 자연스러움 - factory function에서 자유롭게 사용
function createDrawingMode() {
  let isActive = $state(false)
  let derived = $derived(/* ... */)

  $effect(() => {
    // 반응형 사이드 이펙트
  })
}
```

### 2. `this` 문제 회피

JavaScript에서 `this`는 호출 방식에 따라 바뀌는 악명 높은 문제가 있습니다:

```typescript
class Counter {
  count = 0
  increment() { this.count++ }
}

const counter = new Counter()
const fn = counter.increment
fn()  // this가 undefined → 에러!
```

Factory function은 `this`를 아예 사용하지 않으므로 이 문제가 없습니다.

### 3. Composition (조합) 우선

OOP의 상속 대신, 여러 factory의 결과를 조합합니다:

```typescript
// 상속 방식 (이 프로젝트에서는 사용하지 않음)
class DrawingTool extends BaseTool { ... }
class EraserTool extends BaseTool { ... }

// 조합 방식 (이 프로젝트의 방식)
function createPageCanvasManager() {
  const drawing = createDrawingMode({ ... })
  const eraser = createEraserMode({ ... })
  const selection = createSelectionMode({ ... })

  // 필요한 것만 조합해서 사용
  return { drawing, eraser, selection }
}
```

---

## 요약

| 개념 | 한 줄 설명 |
|------|-----------|
| Factory Function | 객체를 만들어 반환하는 함수 (`new` 불필요) |
| Closure | 함수가 자신이 만들어진 환경의 변수를 기억하는 것 |
| Interface (옵션용) | factory function에 전달할 옵션의 형태를 정의 |
| Getter 반환 | `$state` 반응성을 외부에 노출하기 위한 패턴 |
| Composition | 상속 대신 여러 factory 결과를 조합 |

이 프로젝트에서 `create*` 접두사가 붙은 함수는 모두 factory function입니다:
- `createDrawingMode()`
- `createEraserMode()`
- `createSelectionMode()`
- `createPinchZoom()`
- `createScrollMode()`
- 등등
