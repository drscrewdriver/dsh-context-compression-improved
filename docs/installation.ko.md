# dsh-context-compression-improved 설치하기

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md)

이 가이드는 소스에서 포크를 설치합니다. 포크는 아직 npm에 게시되지 않았으며, 패키지 이름은
의도적으로 업스트림과 동일합니다(`dsh-context-compression-improved` 단일 패키지이며,
예전에 별도 패키지였던 runtime이 함께 포함됩니다).

## 사전 요구 사항

- Node `^22.19.0 || >=24` �?pnpm `11.7.0`(`corepack enable`은 `packageManager`�?고정 버전�?사용합니�?.
- `0.1.1-rc.2` peer 범위와 호환되는 DeepSeek Harness(공식 `dsh-v0.1.2-alpha.5` 릴리스에�?검�?.
- DeepSeek V4 모델 경로(`deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`). 코드 스켈레톤 게이트를 포함�?손실 압축은 번들�?정확�?토크나이저가 필요하며, �?외의 경로�?fail-open으로 원본 도구 결과�?유지합니�?
- Git.

## 1. 소스에서 빌드

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build`�?모든 패키지�?�?라이브러�?산출물을 번들합니�?`tsdown`). 설치 전에 전체 테스�?스위트를 실행하려�?`pnpm test`�?먼저 실행하세�?

## 2. Bundle 엔트�?패키지�?pack

셀렉터 패키지가 유일�?Bundle 엔트리이�? 런타임은 정확�?버전 의존성으�?함께 따라옵니�?

```sh
cd packages/selector
pnpm pack
# �?dsh-context-compression-improved-0.1.0.tgz
cd ../..
```

`pnpm pack`은 `prepack` 훅을 통해 번들�?실행하므�? tarball은 항상 체크아웃 내용�?일치합니�?

## 3. Harness 프로파일�?추가

셀렉터 패키지�?Harness Bundle 매니페스�?필드 `dsh.bundle.patch`�?선언하므�? `dsh plugin add`가 표준적인 out-of-tree Bundle 설치 경로입니�?

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.1.0.tgz
dsh --profile web --dump-config
```

설치 �?해당 프로파일�?재시작하세요. 설정 덤프�?셀렉터 Bundle�?활성 상태�?표시되어�?합니�? 셀렉터와 런타�?패키지�?따로 설치하거�?연결하지 **마세�?* �?런타임은 자동으로 설치됩니�?

## 4. 코드 스켈레톤 게이�?켜기

DeepSeek Harness 설정 �?**Context compression selector**�?엽니�?

1. 압축 프로파일�?선택합니�?게이트는 모든 프로파일�?대�?직교합니�?.
2. 필요하면 Auto Compact 트리�?레벨�?조정합니�?50�?0%, 기본�?80%).
3. **Code skeleton compression**�?**On**으로 설정합니�? 토글은 변�?�?저장됩니다.

다른 셀렉터 설정�?마찬가지�?값은 세션�?처음 관찰하�?시점�?고정됩니�?�?게이트는 새로 관찰된 세션에만 적용되며, 실행 중인 작업에는 적용되지 않습니다.

## 5. 업데이트 �?제거

```sh
# 업데이트: pull, 재빌�? �?pack, �?tarball�?다시 추가
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-improved-0.1.0.tgz

# 제거
dsh plugin --profile web remove dsh-context-compression-improved
```

## 문제 해결

- **덤프�?Bundle�?활성으로 표시되지 않음**: 프로파일�?재시작하�? 셀렉터 엔트�?패키지(런타임이 아닌)�?추가했는지, Harness 버전�?호환 peer 범위 내인지 확인하세�?
- **도구 결과가 �?번도 스켈레톤 압축되지 않음**: 게이트는 기본값이 off입니�? 토글�?확인하세�? 압축은 정확�?토크나이저 모델 경로에서 새로 들어�?초대�?소스코드 도구 결과에만 적용되며, 모든 건너뜀은 사유와 함께 감사 기록�?남습니다.
- **토글�?읽을 �?없음으로 표시�?*: 저장된 `codeSkeleton` 섹션�?엄격�?브라우저 디코드에 실패했습니다(정확�?`{ enabled: boolean }`이어�?�?. 잘못�?섹션�?제거하면 기본값으�?돌아갑니�?
- **업데이트 단계 실패**: 플러그인은 npm 패키지 의미론을 따릅니다. 사용 중인 Harness 빌드가 tarball �?업그레이드를 거부하면 먼저 이전 버전�?제거하세�?
