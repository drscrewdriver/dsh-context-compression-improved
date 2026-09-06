# dsh-context-compression-improved

> [dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector) の改良フォーク——DeepSeek Harness 向けの監査可能なツール結果コンテキスト圧縮セレクターに、直交する**コードスケルトン圧縮ゲート**を追加しました。

[English](README.md) · [中文说明](README.zh.md) · [한국어](README.ko.md) · [変更履歴](CHANGELOG.ja.md) · [インストールガイド](docs/installation.ja.md)

> [!NOTE]
> **このフォークがアップストリーム 0.1.0 に追加したもの:**
>
> - 直交する**コードスケルトン圧縮ゲート**（`codeSkeleton.enabled`、デフォルトはオフ）：超大規模なソースコード系ツール結果の初回露出時に、通常の reducer に渡る前でインポートと宣言のスケルトンを保持できます（関数本体は省略、エラー行は保持）。
> - 同じセレクター設定セクション内に、すべての圧縮プロファイルから独立したこのゲートのトグルを追加。
> - CI に組み込まれた ESLint ベースライン、`test:watch` による TDD ループ、英語/簡体字中国語/日本語/韓国語のドキュメント。

> [!IMPORTANT]
> 本プロジェクトは **DeepSeek モデルのみ**をサポートします。可逆的な計測と非可逆圧縮は、同梱の DeepSeek 公式トークナイザー（`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`）に依存します。それ以外は fail-open で動作し、元のツール結果を保持します。安全モデルの詳細は[アップストリームの README](https://github.com/WilliamShi666/dsh-context-compression-selector#model-support-and-safety) を参照してください。

## これは何か

長時間稼働するエージェントタスクは大量のツール出力を蓄積します。本コミュニティプラグインは、DeepSeek Harness のコアを改変することなく、選択可能で監査可能なツール結果コンテキスト圧縮ポリシーを提供します：

- **Fresh**：モデルが受け取る前に、新たにサイズ超過したツール結果セグメントを事前圧縮します。
- **Aggregate**：Fresh 圧縮後も予算を超える場合、再度圧縮します。
- **History / micro-compact**：直近の作業コンテキストを保護しつつ、対象となる古いツール結果を置き換えます。
- **TailTrim**：Custom のみで有効化できる任意のテール縮小パスです。
- **Native**：Harness 方式の先頭/中間/末尾トリミングを明示的なプロファイルとして保持します。
- **コードスケルトン（新規、直交ゲート）**——下記参照。

すべての判断は記録されます：ステージ、reducer、トリガー理由、スキップ理由、そして取得可能な場合は正確なトークン数。

## コードスケルトンゲート（新規）

ゲートを有効にすると、超大規模な**ソースコード系の新規ツール結果**（例：大きな `read_file`）に対して、まずスケルトン圧縮を試みます：インポートと型/関数/クラス宣言を保持し、関数本体をマーカー付きで省略し、省略された本体の中のエラー行を保持します。スケルトンを生成できない、または検証できない場合は、元の先頭トリミングへフォールバックします——このゲートがコンテキストを悪化させることはありません。

特徴：

- **直交**：選択されたプロファイル（`balanced`、`savings`、`cache-strict`、`adaptive`、`custom`、`off`、`native`）から独立しています。すべてのプロファイルでゲートを利用できます。
- **デフォルトはオフ**：`codeSkeleton: { enabled: false }`。明示的に有効化するまで動作しません。
- **計測が前提**：正確な DeepSeek トークナイザーが必要で、利用不可の場合は fail-open します。
- **セッション凍結**：他のセレクター設定と同様、変更は新しく観測されたセッションにのみ適用されます。
- **厳格なパース**：`codeSkeleton` は正確に `{ enabled: boolean }` である必要があります。不正な値はランタイム側でスローされ、ブラウザー UI 側では読み取り不能として表示されます。

## 設定 UI

同じ設定セクションで、圧縮プロファイルの選択、Auto Compact トリガーレベルの調整、コードスケルトン圧縮のトグルが行えます。トグルは変更時に即保存され、再読み込み時には保存済みの状態が表示されます。

![Context Compression Selector 設定 UI](docs/assets/context-compression-selector-settings.png)

## インストール

ソースからビルドしてインストールします（本フォークはまだ npm に公開していません。内部パッケージ名は意図的にアップストリームのままです）：

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

その後、セレクターパッケージを pack して Harness プロファイルに追加します——検証とアンインストールを含む完全な手順は[インストールガイド](docs/installation.ja.md)を参照してください。

## 開発

```sh
pnpm install --frozen-lockfile
pnpm lint          # ESLint ベースライン（CI でも強制）
pnpm typecheck     # runtime + selector + tests の tsc と bundle ステップ
pnpm test          # vitest フルスイート
pnpm test:watch    # TDD ループ：先に失敗する回帰テストを書き、それを通す
pnpm build
pnpm verify:release
```

コントリビューションはアップストリームの規律に従います：先に失敗する回帰テストを追加し、プロダクション変更はすべてこのリポジトリ内に収め、「発火した」「有効だがスキップされた」「fail-open」の証拠をそれぞれ別に示してください。詳細は [CONTRIBUTING.md](CONTRIBUTING.md)。

## 互換性

- 公開されているプラグインおよびプロファイル API のみを使用し、DeepSeek Harness `dsh-v0.1.1-rc.2` に対して検証済み。公式 `dsh-v0.1.2-alpha.5` リリースと互換。
- Node `^22.19.0 || >=24` と pnpm `11.7.0` が必要です。
- プラグインは Harness の公開拡張 API のみを使用し、Harness コアは改変しません。非公式のコミュニティプロジェクトであり、DeepSeek とは提携・承認関係にありません。

## クレジットとライセンス

- アップストリームのプロジェクトと既存のすべての成果：[WilliamShi666/dsh-context-compression-selector](https://github.com/WilliamShi666/dsh-context-compression-selector)（作者 WilliamShi666、MIT）。
- フォークによる追加（コードスケルトンゲート、ツールチェーン、多言語ドキュメント）：drscrewdriver。
- MIT——[LICENSE](LICENSE)（アップストリームの著作権表示を保持）を参照。同梱トークナイザーの出所は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
