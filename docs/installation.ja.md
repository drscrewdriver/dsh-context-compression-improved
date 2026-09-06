# dsh-context-compression-improved をインストールする

> [English](installation.md) · [中文](installation.zh.md) · [日本語](installation.ja.md) · [한국어](installation.ko.md)

このガイドでは、ソースからフォークをインストールします。フォークはまだ npm に公開されておらず、内部パッケージ名は意図的にアップストリームと同一です（`dsh-context-compression-selector` と、その正確なバージョン依存 `dsh-context-compression-selector-runtime`）。

## 前提条件

- Node `^22.19.0 || >=24` と pnpm `11.7.0`（`corepack enable` で `packageManager` の固定バージョンが使われます）。
- `0.1.1-rc.2` peer 範囲に互換する DeepSeek Harness（公式 `dsh-v0.1.2-alpha.5` リリースに対して検証済み）。
- DeepSeek V4 モデルルート（`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`）。コードスケルトンゲートを含む非可逆圧縮には同梱の正確なトークナイザーが必要で、その他のルートは fail-open で元のツール結果を保持します。
- Git。

## 1. ソースからビルド

```sh
git clone https://github.com/drscrewdriver/dsh-context-compression-improved.git
cd dsh-context-compression-improved
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` はすべてのパッケージの両方のライブラリ成果物をバンドルします（`tsdown`）。インストール前にフルスイートを実行したい場合は `pnpm test` を実行してください。

## 2. Bundle エントリーパッケージを pack

selector パッケージが唯一の Bundle エントリーで、ランタイムはその正確なバージョン依存として付いてきます：

```sh
cd packages/selector
pnpm pack
# → dsh-context-compression-selector-0.1.0.tgz
cd ../..
```

`pnpm pack` は `prepack` フック経由でバンドルを実行するため、tarball は常にチェックアウト内容と一致します。

## 3. Harness プロファイルに追加

selector パッケージは Harness Bundle マニフェストフィールド `dsh.bundle.patch` を宣言しているため、`dsh plugin add` が標準のアウトオブツリー Bundle インストール経路になります：

```sh
dsh plugin --profile web add packages/selector/dsh-context-compression-selector-0.1.0.tgz
dsh --profile web --dump-config
```

インストール後、対象プロファイルを再起動してください。設定ダンプに selector Bundle が有効として表示されるはずです。selector と runtime の 2 パッケージを別々にインストール・接続**しないでください**——runtime は自動的にインストールされます。

## 4. コードスケルトンゲートを有効にする

DeepSeek Harness の設定 → **Context compression selector** を開きます：

1. 圧縮プロファイルを選択します（ゲートはすべてのプロファイルに対して直交します）。
2. 必要に応じて Auto Compact トリガーレベルを調整します（50–90%、デフォルト 80%）。
3. **Code skeleton compression** を **On** にします。トグルは変更時に保存されます。

他のセレクター設定と同様、値はセッションが最初に観測した時点で凍結されます——ゲートは新しく観測されたセッションにのみ影響し、実行中のタスクには適用されません。

## 5. 更新と削除

```sh
# 更新：pull、再ビルド、再 pack、新しい tarball を再追加
git pull && pnpm install --frozen-lockfile && pnpm build
cd packages/selector && pnpm pack && cd ../..
dsh plugin --profile web add packages/selector/dsh-context-compression-selector-0.1.0.tgz

# 削除
dsh plugin --profile web remove dsh-context-compression-selector
```

## トラブルシューティング

- **ダンプに Bundle が有効と表示されない**：プロファイルを再起動し、selector エントリーパッケージ（runtime ではなく）を追加したこと、Harness のバージョンが互換 peer 範囲内であることを確認してください。
- **ツール結果が一切スケルトン圧縮されない**：ゲートはデフォルトでオフです。トグルを確認してください。圧縮は、正確なトークナイザーのモデルルート上の、新規かつ超大規模なソースコード系ツール結果にのみ適用され、すべてのスキップは理由付きで監査記録に残ります。
- **トグルが読み取り不能と表示される**：保存済みの `codeSkeleton` セクションが厳格なブラウザーデコードに失敗しています（正確に `{ enabled: boolean }` である必要があります）。不正なセクションを削除すればデフォルトに戻ります。
- **更新手順が失敗する**：プラグインは npm パッケージのセマンティクスに従います。お使いの Harness ビルドが tarball 間のアップグレードを拒否する場合は、まず古いバージョンを削除してください。
