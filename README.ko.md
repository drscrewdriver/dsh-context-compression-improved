# dsh-context-compression-improved

> [dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector)�?개선 포크——DeepSeek Harness�?감사 가능한 도구 결과 컨텍스트 압축 셀렉터�? 직교하는 **코드 스켈레톤 압축 게이�?*�?추가했습니다.

[English](README.md) · [中文说明](README.zh.md) · [日本語](README.ja.md) · [변�?로그](CHANGELOG.ko.md) · [설치 가이드](docs/installation.ko.md)

> [!NOTE]
> **�?포크가 업스트림 0.1.0�?추가�?�?**
>
> - 직교하는 **코드 스켈레톤 압축 게이�?*(`codeSkeleton.enabled`, 기본�?off): 매우 �?소스코드 도구 결과가 처음 노출�?�? 일반 리듀서로 넘어가�?전에 임포트와 선언부�?스켈레톤�?보존�?�?있습니다(함수 본문은 생략, 에러 라인은 유지).
> - 동일�?셀렉터 설정 섹션�?모든 압축 프로파일�?독립적인 �?게이트의 토글�?추가.
> - CI�?통합�?ESLint 베이스라�? `test:watch` TDD 루프, 영어/중국�?간체)/일본�?한국�?문서.

> [!IMPORTANT]
> �?프로젝트�?**DeepSeek 모델�?* 지원합니다. 손실 없는 측정�?손실 압축은 번들�?DeepSeek 공식 토크나이저(`deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`)�?의존합니�? �?외의 경우 fail-open으로 동작하며 원본 도구 결과�?유지합니�? 전체 안전 모델은 [업스트림 README](https://github.com/WilliamShi666/dsh-context-compression-selector#model-support-and-safety)�?참고하세�?

## 이것은 무엇인가

장시�?실행되는 에이전트 작업은 대량의 도구 출력�?축적합니�? �?커뮤니티 플러그인은 DeepSeek Harness 코어�?수정하지 않고, 선택 가능하�?감사 가능한 도구 결과 컨텍스트 압축 정책�?제공합니�?

- **Fresh**: 모델�?받기 전에 새로 커진 도구 결과 세그먼트�?사전 압축합니�?
- **Aggregate**: Fresh 압축 후에�?예산�?초과하면 다시 압축합니�?
- **History / micro-compact**: 최근 작업 컨텍스트�?보호하면�?대상이 되는 오래�?도구 결과�?교체합니�?
- **TailTrim**: Custom에서�?활성화할 �?있는 선택�?테일 축소 경로입니�?
- **Native**: Harness 방식�?head/중간/tail 트리밍을 하나�?명시�?프로파일�?유지합니�?
- **코드 스켈레톤(신규, 직교 게이�?**——아�?참고.

모든 결정은 기록됩니�? 단계, 리듀�? 트리�?이유, 건너뜀 이유, 그리�?가능한 경우 정확�?토큰 �?

## 코드 스켈레톤 게이�?신규)

게이트를 활성화하�?매우 �?**소스코드 도구 결과**(�? �?`read_file`)�?대�?먼저 스켈레톤 축소�?시도합니�? 임포트와 타�?함수/클래�?선언�?유지하고, 함수 본문은 마커와 함께 생략하며, 생략�?본문 안의 에러 라인은 보존합니�? 스켈레톤�?생성하거�?검증할 �?없으�?원래�?head 트리밍으�?폴백합니다——이 게이트가 컨텍스트�?악화시킬 수는 없습니다.

특성:

- **직교**: 선택�?프로파일(`balanced`, `savings`, `cache-strict`, `adaptive`, `custom`, `off`, `native`)�?독립적입니다. 모든 프로파일�?�?게이트를 받습니다.
- **기본�?off**: `codeSkeleton: { enabled: false }`이며, 직접 켜기 전까지�?동작하지 않습니다.
- **측정�?선행**: 정확�?DeepSeek 토크나이저가 필요하며, 사용�?�?없으�?fail-open합니�?
- **세션 고정**: 다른 셀렉터 설정�?마찬가지�?변�?사항은 새로 관찰된 세션에만 적용됩니�?
- **엄격�?파싱**: `codeSkeleton`은 정확�?`{ enabled: boolean }`이어�?합니�? 잘못�?값은 런타�?쪽에�?예외�?던지�? 브라우저 UI에서�?읽을 �?없음으로 표시됩니�?

## 설정 UI

동일�?설정 섹션에서 압축 프로파일 선택, Auto Compact 트리�?레벨 조정, 코드 스켈레톤 압축 토글�?모두 처리�?�?있습니다. 토글은 변�?�?즉시 저장되�? 다시 불러�?�?저장된 상태가 표시됩니�?

![Context Compression Selector 설정 UI](docs/assets/context-compression-selector-settings.png)

## 설치

소스에서 빌드하여 설치합니�?�?포크�?아직 npm�?게시되지 않았습니�? 내부 패키지 이름은 의도적으�?업스트림�?동일하게 유지됩니�?:

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

이후 셀렉터 패키지�?pack 해서 Harness 프로파일�?추가합니다——검증과 제거�?포함�?전체 절차�?[설치 가이드](docs/installation.ko.md)�?참고하세�?

## 개발

```sh
pnpm install --frozen-lockfile
pnpm lint          # ESLint 베이스라�?CI에서�?강제)
pnpm typecheck     # runtime + selector + tests tsc �?bundle 단계
pnpm test          # vitest 전체 스위�?
pnpm test:watch    # TDD 루프: 먼저 실패하는 회귀 테스트를 작성하고, 통과시킨�?
pnpm build
pnpm verify:release
```

기여�?업스트림�?규율�?따릅니다: 먼저 실패하는 회귀 테스트를 추가하고, 모든 프로덕션 변경은 �?저장소 안에 유지하며, "트리거됨", "활성화되었지�?건너뜀", "fail-open"�?증거�?각각 따로 제시하세�? [CONTRIBUTING.md](CONTRIBUTING.md) 참고.

## 호환�?

- 공개�?플러그인 �?프로파일 API�?사용하여 DeepSeek Harness `dsh-v0.1.1-rc.2`에서 검증되었으�? 공식 `dsh-v0.1.2-alpha.5` 릴리스와 호환됩니�?
- Node `^22.19.0 || >=24`와 pnpm `11.7.0`�?필요합니�?
- 플러그인은 Harness�?공개 확장 API�?사용하며 Harness 코어�?수정하지 않습니다. 비공�?커뮤니티 프로젝트이며 DeepSeek�?제휴하거�?승인받지 않았습니�?

## 크레딧과 라이선스

- 업스트림 프로젝트와 기존�?모든 작업: [WilliamShi666/dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector), 작성�?WilliamShi666(MIT).
- 포크에서 추가�?�?코드 스켈레톤 게이�? 툴체�? 다국�?문서): drscrewdriver.
- MIT——[LICENSE](LICENSE)(업스트림 저작권 표기 유지) 참고. 번들�?토크나이저�?출처�?[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
