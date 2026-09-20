# 変更履歴（フォークの追加エントリー）

> 完全な履歴（アップストリーム 0.1.0 以前を含む）は [CHANGELOG.md](CHANGELOG.md) を参照。このファイルはフォークの追加エントリーのみを翻訳したものです。 · [English](CHANGELOG.md) · [中文](CHANGELOG.zh.md) · [한국어](CHANGELOG.ko.md)

## 0.5.2 - 2026-09-20

### Changed（変更）

- 人手ゲート付きレビューパイプライン（review gate、beta）を**廃止**しました。その意味論は
  「助言」に置き換わります。便益モデルは従来どおり 1 パスを 1 回の統合 mutation として
  価格付けしますが、算出したバンド（`profitable` / `high-impact` / `slow-payback` /
  `unpriceable` / `not-worth-it`）は `reduction-advice` 監査レコードとして公開され、
  advisor レポートルートにスナップショットされるだけになりました——reduction を保留・遅延・
  書き換えることはありません。この gate は機能自身の要件（削減は自動処理を妨げない）と矛盾し、
  出荷既定（`reviewMode` 有効 + 4,000 トークンの高影響しきい値に対し 8,192 トークンの
  fresh トリガー）では fresh バッチを 100% 人手レビューへ迂回させ、有効化した利用者から
  自動経路を事実上奪っていました。助言のしきい値はモジュール定数（α `0.1`、高影響
  `4,000` トークン）になりました。何もこれに従って動作しないため、設定項目ではなくなります。
- gate とともに削除：レビューキューとその `storageDomain` アダプタ、プロセス全体の
  レジストリ、`review-queue` / `review-decide` の HTTP ルートと `reviewQueueRoute` 配置
  フラグ、`shell.overlay` クライアントパネル、`reviewMode` / `reviewTimeoutTurns` /
  `cacheHitDiscountAlpha` / `reviewHighImpactTokens` の設定キー、`review-outcome` 監査種別。
  4 つの設定キーは**両方のデコーダで引き続き受理され無視されます**——既存の文書（稼働中は
  `reviewMode: false` を含む）はそのまま読み込まれ、設定カードも表示されます——そして解決済み
  policy には決して到達しません。読み取り専用の `GET .../advisor-report` は `lastAdvice` も
  返します。

### Added（追加）

- 廃止に対する回帰ピン：かつて全量を迂回させていた設定（`reviewMode: true`、
  `reviewHighImpactTokens: 1`）で fresh バッチが**そのまま着地**し、`high-impact` の助言
  レコードがそれを記述することをホスト統合テストで固定。ランタイムパーサとブラウザデコーダの
  両側で「受理して無視」を固定する非推奨契約テストも追加。

### Rollback（ロールバック）

- gate を含む最後のリリースへ戻す：`npm dist-tag add
  dsh-context-compression-improved@0.5.1 dsh-0.1.5 --registry https://registry.npmjs.org/`
  の後、`dsh plugin --profile web add dsh-context-compression-improved@0.5.1`。

## 0.5.1 - 2026-09-20

### Fixed（修正）

- 同一 identity を並行して compose する preset-overlay が Windows で失敗しなくなりました。
  公開は宛先パスごとに直列化し、それでも原子的 rename が競合に敗れた場合は、宛先が
  このステージングファイルと同じ `{mtimeMs, size}` standing key を既に持っていることを
  確認してから成功と見なします。Windows の `MoveFileEx` はこの競合を `EPERM`/`EBUSY` と
  して報告しますが、POSIX の `rename` は単に置き換えます——これが並行セッション開始時に
  `standingKeyFor()` を投げさせていました。一致しない宛先はこれまで通り明確に失敗し、
  静かな世代の再利用は禁止されたままです。
- この問題と他の既存レッドゲートを覆い隠していたリリースゲート／テストの修正
  （packed smoke の陳旧な識別子と廃止済み audit reason、古い client inject 期待値、
  Windows 限定の spawn トラップ）。

## 0.5.0 - 2026-09-20

### Added（追加）

- アドバイザリー関連度アドバイザー（統計と提案のみ、デフォルト無効）：各ターン境界で
  fire-and-forget のパスを実行し、最新の `todo/write` イベントからセッションの末端タスク
  意味を要約し（todolist が無い場合は直近のユーザーテキストへフォールバック）、履歴
  tool-result 候選の「内容+コメント意味 ↔ 現在タスク」の関連度を増分スコアリングし、
  prefix-decay（characterPressure 重み付けの関連度平均の逆数）を算出します。関連度の低い
  古いセグメントは `recertified` として記録されますが、これは将来の history 積極度判断への
  提案入力に過ぎず——今回それを消費する経路は存在せず、アドバイザーの出力が着地すべき
  reduction を抑制・遅延・書き換えすることは決してありません（専用の不変テストで固定）。
  `presetOptions.advisor*` 設定キーで設定（`advisorMode` `''|'host'|'direct'`、既定 `''`；
  direct チャネルは estimator のエンドポイントを再利用；`SideChannel` に任意の overrides
  引数を追加し、設定を共有せずトランスポートを共有）。可観測性：新しい `advisor-outcome`
  監査レコード（content-free、summary / scoring / decay の各フェーズごとに 1 件）と、読み
  取り専用 HTTP ルート `GET .../advisor-report?sessionId=`（デプロイ opt-in フラグ
  `advisorReportRoute`、review ルートと同じ骨格）。クライアント UI は今回意図的に未提供。

## 0.4.0 - 2026-09-20

### Fixed（修正）

- プラグインはルーティング model id に依存しなくなりました。すべての計画ゲートは
  exact tokenizer カウントの代わりに文字基数（Unicode コードポイント、
  `characterPressure` / `pressureCost` 経由）で判定するため、バンドル tokenizer を
  持たないルート（実運用の `deepseek-flash`）でもリライトが沈黙せず着地します。
  token しきい値のキー名と値は保持され（既存の 4.0 文字/token 規約で変換、
  凍結済み profile ベースラインは無変更）、token 数値はテレメトリに降格され、
  rewrite 監査レコードの新フィールド `measurementBasis` が正直に区別します
  （`exact-tokenizer` と `characters`、派生時は `tokenizerId: 'characters'` /
  `tokenizerRevision: 'chars-per-token-4.0'`）。ロールバック: 後続の変更が本コミットに
  依存していないことを確認した上で `git revert 7a1972a` を実行してください。
### Changed（0.1.5 互換 / compat/0.1.5 ブランチ）

- runtime パッケージを selector パッケージへ統合しました。1 回のインストールでスタック全体が入り、
  リポジトリのルートがインストール面になります（`name`、`main`、`types`、`./pruner` と
  `./invariant` を含む `exports`、`dependencies`、`dsh`）。ツールチェーン・スクリプト・CI も
  単一パッケージへ揃えました。実機で検証済みの estimator-catalog ルート登録（二重プレフィックス、
  保護された二経路の有効化、リクエスト毎のサービス解決、可観測なライフサイクルログ）を本ラインへ
  再適用し、ホスト側のガードを追加しました。`ab2175a` で `z.any()` に落とされていた settings
  スキーマを復元し、Custom の既定値が再び公開されます。
- ブランチ上で公式 DeepSeek Harness `v0.1.5-rc.2` に適応。`@deepseek-ai/dsh-*` 全開発依存と e2e 公式ホスト一覧を `0.1.1-rc.2` から `0.1.5-rc.2` へ更新（cordis `4.0.2`、schemastery `3.18.2`、新分割パッケージ群と `dsh-client-store` クライアントスタックを含む）。
- surface 置換は v3 の `startSeq`/`endSeq` 形状とブランド化 `SessionSeq` を使用。surface node のイベント解決は配列インデックスではなく seq 検索に変更。
- クライアントバンドルは削除された `@deepseek-ai/dsh-client-runtime` を参照しない。settings 型は `@deepseek-ai/dsh-client-ui-settings`、セッション hooks は `@deepseek-ai/dsh-client-ui-session` から取得。`engines.dsh >=0.1.5-alpha.1 <0.2.0-0` を宣言。
- Harness 0.1.5 はセッション `agentPreset` をブラウザへ公開しないため、クライアント側で Minimal セッションを検出できない。セレクターは選択可能なまま。
- テストを 0.1.5 のセマンティクスに更新（`.await()`、`SessionProjectionRegistry`、`stream: []`、文字列の settings 名前空間）。

### 修正

- エスティメーターカードは Harness ホストチャネルで API キーを要求しなくなりました。ホストチャネルを選ぶと、ライブのプロバイダー/モデル ドロップダウンが表示され、実際に使われるルート（明示的な上書き、なければセッション既定モデル）を明示します。キー入力欄と 2 つ目の手入力モデル欄は表示されません — エンドポイント URL、モデルのテキスト欄、書き込み専用キーはダイレクト接続チャネルだけに属します。
- `presetOptions` の書き込みをパス指定方式に変更しました。従来はセクション全体を置き換えていたため、エスティメーターの 2 つ目のフィールド（プロバイダー、モデル、エンドポイント）に触れると `estimatorMode` と他のすべての上書きが削除され、パネルは保存成功と表示したままエスティメーターが静かにオフへ戻っていました。現在は各フィールドが自分のパスだけを書き込み、`undefined` は指定したフィールドだけを消去し、confirm-on-write はチャネル単独ではなく同じフィールド群を検証します。
- 回帰カバレッジを追加：`packages/selector/tests/preset-options-write.client.spec.ts`（パス単位の書き込み、兄弟フィールドの保持、明示的な消去、変更なし時の無書き込み、未コミット書き込みの報告）と `packages/selector/tests/estimator-channel.client.spec.tsx`（チャネル別フィールド、カタログのドロップダウン、手入力フォールバック）。

### 追加

- 直交するコードスケルトン圧縮ゲート（`codeSkeleton.enabled`、デフォルトはオフ）：超大規模なソースコード系ツール結果の初回露出時に、インポートと宣言のスケルトンを保持できます（関数本体は省略、エラー行は保持）。失敗時は元の先頭トリミングへフォールバックします。ゲートはすべてのプロファイルから独立し、正確なトークナイザー計測を前提とします。
- セレクター設定セクションにゲートのトグルを追加（簡体字中国語・英語のコピー付き）。
- 新セクションのブラウザー/ランタイム デコード整合テスト、`saveCodeSkeleton` の confirm-on-write コントラクトテスト、およびドキュメント全体のパリティ行列拡張。

### 変更

- ESLint フラット設定ベースライン（`pnpm lint`、CI でも強制）と `pnpm test:watch` による TDD ループを追加。デッドインポートを整理し、lint ベースラインで浮かび上がった 2 つのエラー経路を強化しました。
- 本リポジトリは `WilliamShi666/dsh-context-compression-selector` の改良フォークとして管理されます。ドキュメントは英語・簡体字中国語・日本語・韓国語で提供されます。
