# 変更履歴（フォークの追加エントリー）

> 完全な履歴（アップストリーム 0.1.0 以前を含む）は [CHANGELOG.md](CHANGELOG.md) を参照。このファイルはフォークの追加エントリーのみを翻訳したものです。 · [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [한국어](CHANGELOG.ko.md)

## Unreleased（未リリース）
### Changed（0.1.5 互換 / compat/0.1.5 ブランチ）

- ブランチ上で公式 DeepSeek Harness `v0.1.5-rc.2` に適応。`@deepseek-ai/dsh-*` 全開発依存と e2e 公式ホスト一覧を `0.1.1-rc.2` から `0.1.5-rc.2` へ更新（cordis `4.0.2`、schemastery `3.18.2`、新分割パッケージ群と `dsh-client-store` クライアントスタックを含む）。
- surface 置換は v3 の `startSeq`/`endSeq` 形状とブランド化 `SessionSeq` を使用。surface node のイベント解決は配列インデックスではなく seq 検索に変更。
- クライアントバンドルは削除された `@deepseek-ai/dsh-client-runtime` を参照しない。settings 型は `@deepseek-ai/dsh-client-ui-settings`、セッション hooks は `@deepseek-ai/dsh-client-ui-session` から取得。`engines.dsh >=0.1.5-alpha.1 <0.2.0-0` を宣言。
- Harness 0.1.5 はセッション `agentPreset` をブラウザへ公開しないため、クライアント側で Minimal セッションを検出できない。セレクターは選択可能なまま。
- テストを 0.1.5 のセマンティクスに更新（`.await()`、`SessionProjectionRegistry`、`stream: []`、文字列の settings 名前空間）。

### 追加

- 直交するコードスケルトン圧縮ゲート（`codeSkeleton.enabled`、デフォルトはオフ）：超大規模なソースコード系ツール結果の初回露出時に、インポートと宣言のスケルトンを保持できます（関数本体は省略、エラー行は保持）。失敗時は元の先頭トリミングへフォールバックします。ゲートはすべてのプロファイルから独立し、正確なトークナイザー計測を前提とします。
- セレクター設定セクションにゲートのトグルを追加（簡体字中国語・英語のコピー付き）。
- 新セクションのブラウザー/ランタイム デコード整合テスト、`saveCodeSkeleton` の confirm-on-write コントラクトテスト、およびドキュメント全体のパリティ行列拡張。

### 変更

- ESLint フラット設定ベースライン（`pnpm lint`、CI でも強制）と `pnpm test:watch` による TDD ループを追加。デッドインポートを整理し、lint ベースラインで浮かび上がった 2 つのエラー経路を強化しました。
- 本リポジトリは `WilliamShi666/dsh-context-compression-selector` の改良フォークとして管理されます。ドキュメントは英語・簡体字中国語・日本語・韓国語で提供されます。
