# dsh-context-compression-improved 설치하기

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md)

이 가이드는 포크를 소스에서 설치하는 방법을 다룹니다. 포크는 아직 npm에 게시되지 않았으며, 내부 패키지 이름은 의도적으로 업스트림과 동일합니다(`dsh-context-compression-selector` 및 정확한 버전 의존성 `dsh-context-compression-selector-runtime`).

## 사전 요구 사항

- Node `^22.19.0 || >=24` 및 pnpm `11.7.0`(`corepack enable`은 `packageManager`의 고정 버전을 사용합니다).
- `0.1.1-rc.2` peer 범위와 호환되는 DeepSeek Harness(공식 `dsh-v0.1.2-alpha.5` 릴리스에서 검증).
- DeepSeek V4 모델 경로(`deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`). 코드 스켈레톤 게이트를 포함한 손실 압축은 번들된 정확한 토크나이저가 필요하며, 그 외의 경로는 fail-open으로 원본 도구 결과를 유지합니다.
- Git.

## 1. 소스에서 빌드

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build`는 모든 패키지의 두 라이브러리 산출물을 번들합니다(`tsdown`). 설치 전에 전체 테스트 스위트를 실행하려면 `pnpm test`를 먼저 실행하세요.

## 2. Bundle 엔트리 패키지를 pack

셀렉터 패키지가 유일한 Bundle 엔트리이며, 런타임은 정확한 버전 의존성으로 함께 따라옵니다:

```sh
cd packages/selector
pnpm pack
# → dsh-context-compression-selector-0.1.0.tgz
cd ../..
```

`pnpm pack`은 `prepack` 훅을 통해 번들을 실행하므로, tarball은 항상 체크아웃 내용과 일치합니다.

## 3. Harness 프로파일에 추가

셀렉터 패키지는 Harness Bundle 매니페스트 필드 `dsh.bundle.patch`를 선언하므로, `dsh plugin add`가 표준적인 out-of-tree Bundle 설치 경로입니다:

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-selector-0.1.0.tgz
dsh --profile web --dump-config
```

설치 후 해당 프로파일을 재시작하세요. 설정 덤프에 셀렉터 Bundle이 활성 상태로 표시되어야 합니다. 셀렉터와 런타임 패키지를 따로 설치하거나 연결하지 **마세요** — 런타임은 자동으로 설치됩니다.

## 4. 코드 스켈레톤 게이트 켜기

DeepSeek Harness 설정 → **Context compression selector**를 엽니다:

1. 압축 프로파일을 선택합니다(게이트는 모든 프로파일에 대해 직교합니다).
2. 필요하면 Auto Compact 트리거 레벨을 조정합니다(50–90%, 기본값 80%).
3. **Code skeleton compression**을 **On**으로 설정합니다. 토글은 변경 시 저장됩니다.

다른 셀렉터 설정과 마찬가지로 값은 세션이 처음 관찰하는 시점에 고정됩니다 — 게이트는 새로 관찰된 세션에만 적용되며, 실행 중인 작업에는 적용되지 않습니다.

## 5. 업데이트 및 제거

```sh
# 업데이트: pull, 재빌드, 재 pack, 새 tarball을 다시 추가
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-selector-0.1.0.tgz

# 제거
dsh plugin --profile web remove dsh-context-compression-selector
```

## 문제 해결

- **덤프에 Bundle이 활성으로 표시되지 않음**: 프로파일을 재시작하고, 셀렉터 엔트리 패키지(런타임이 아닌)를 추가했는지, Harness 버전이 호환 peer 범위 내인지 확인하세요.
- **도구 결과가 한 번도 스켈레톤 압축되지 않음**: 게이트는 기본값이 off입니다. 토글을 확인하세요. 압축은 정확한 토크나이저 모델 경로에서 새로 들어온 초대형 소스코드 도구 결과에만 적용되며, 모든 건너뜀은 사유와 함께 감사 기록에 남습니다.
- **토글이 읽을 수 없음으로 표시됨**: 저장된 `codeSkeleton` 섹션이 엄격한 브라우저 디코드에 실패했습니다(정확히 `{ enabled: boolean }`이어야 함). 잘못된 섹션을 제거하면 기본값으로 돌아갑니다.
- **업데이트 단계 실패**: 플러그인은 npm 패키지 의미론을 따릅니다. 사용 중인 Harness 빌드가 tarball 간 업그레이드를 거부하면 먼저 이전 버전을 제거하세요.
