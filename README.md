# create-knowledge-monthly-report

## What is this?

このソースコードは[Knowledge](https://information-knowledge.support-project.org/ja/#google_vignette)で投稿した記事の一覧を取得し、レポートとして出力するスクリプトです。

## Setup

`git clone`後、プロジェクト直下で npm package の依存関係を install します。

```bash
$ npm i
```

別途、node.js（20.17.0）が必要です。

## How To

初めに[.env.sample](.env.sample)をプロジェクトディレクトリ直下にコピーし、`.env`にファイル名を書き換え、テキストの中身を書き換えてください。

Setup後にターミナルで以下のコマンドを実行することで`/tmp`下にレポートが出力されます。

```bash
$ npm run scrape -- -m [対象日（yyyyMM形式）]
# 例: 2024年12月を出力する場合
$ npm run scrape -- -m 202412
```

また、出力形式を変更できるように[/templates配下にテンプレート](templates/template.sample.txt)を用意しています。

コマンドライン引数でファイルのpathを指定すると任意のフォーマットで結果を出力することが可能です。

```bash
$ npm run scrape -- -m 202412 -t [テンプレートのファイル名]
# 例: ファイル templates/custom-template.txt をテンプレートとして利用しない場合
$ npm run scrape -- --headless -m 202412 -t templates/custom-template.txt
```

テンプレートファイルは`@`で囲んだ任意の文字が置換される仕様になっています。

| 変数                  | 置換される値                               |
| :-------------------- | :----------------------------------------- |
| @knowledgeUrl@        | .envファイルで指定したKnowledgeのURL       |
| @targetMonth@         | 指定した月（YYYY年MM月形式）               |
| @targetMonthArticles@ | 指定した月の投稿内容（title, 寄稿者, URL） |
| @popularArticles@     | 人気の投稿内容（title, 寄稿者, URL）       |
| @contributionGraph@   | 日毎投稿有無のグラフ                       |

その他のコマンドライン引数は`--help`のオプションで確認してください。

```bash
$ npm run scrape -- --help
```

## Linting

ESLint を利用し、Lint を実行しています。

```bash
$ npm run lint:eslint
```

VSCode の拡張機能と併用することで、ファイル保存時に実行します。
また、husky と併せて利用しており、commit 時にチェックを実行しているため、エラー状態での commit を抑止します。

## Formatting

prettier を利用し、コードの整形を行なっています。

```bash
$ npm run lint:prettier
```

VSCode の拡張機能と併用することで、ファイル保存時に実行します。
また、husky と併せて利用しており、commit 時にチェックを実行し、自動で整形します。
