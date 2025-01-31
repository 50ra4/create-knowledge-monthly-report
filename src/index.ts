import { config } from 'dotenv';
import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { chromium, Locator, Page } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, format, isValid } from 'date-fns';

/** 記事情報のオブジェクト */
type ArticleMeta = {
  no: number;
  title: string;
  url: string;
  author: string;
  postedDate: string;
};

type MonthFormat = 'yyyyMM' | 'yyyy年MM月';

const parseMonth = (s: string, f: MonthFormat) => parse(s, f, new Date());

const formatMonth = (d: Date, f: MonthFormat) => format(d, f);

/**
 * Locatorから記事情報を抜き出す
 */
const createArticleExtractor =
  (url: string) =>
  async (locator: Locator): Promise<ArticleMeta> => {
    const hrefText = await locator
      .locator('div.insert_info > a')
      .first()
      .getAttribute('href');
    const numberText = await locator
      .locator('div.list-title > span.dispKnowledgeId')
      .first()
      .textContent();
    const titleText = await locator
      .locator('div.list-title')
      .first()
      .textContent();
    const authorText = await locator
      .locator('div > div > a')
      .first()
      .textContent();

    const postDateText = await locator.locator('div > div').first().innerText();

    const urlObj = new URL(url);
    const subDirectory = urlObj.pathname === '/' ? '' : urlObj.pathname;

    const articleUrl = join(
      url,
      // NOTE: サブディレクトリとクエリパラメータを外す
      // input: /foo/aaaaa/bbbb/cccc?=...
      // expect: aaaa,bbbb,cccc
      ...(hrefText ?? '').replace(subDirectory, '').split('?')[0].split('/'),
    );
    const no = +(numberText ?? '').trim().slice(1);
    const title = (titleText ?? '').replace(`#${no}`, '').trim();

    // NOTE: '[未読] aaaa bbbb が 2024/12/30 12:32 に投稿' となっているので、日時のみを取得する
    const postedDate =
      (postDateText ?? '').match(/\d{4}\/\d{2}\/\d{2} \d{1,2}:\d{2}/)?.[0] ??
      '';

    return {
      url: articleUrl,
      no,
      title,
      author: authorText ?? '',
      postedDate,
    };
  };

/**
 * playwrightを使ってブラウザを操作する
 */
const scribePage = async (
  page: Page,
  {
    url,
    id,
    password,
  }: {
    url: string;
    id: string;
    password: string;
  },
) => {
  // Headerの設定
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ja',
  });

  // ログインページに移動
  await page.goto(join(url, '/'));

  // ページ遷移が正常か？
  const topPageTitle = await page.title();
  if (!topPageTitle.match(/Knowledge/)) {
    throw new Error('Failed to transition to top page.');
  }

  // IDとPassword入力
  await page.getByPlaceholder('ID').fill(id);
  await page.getByPlaceholder('パスワード').fill(password);

  // ログインボタンを押下
  await page.getByRole('button', { name: /サインイン/ }).click();

  // ログイン後の画面に遷移したことを確認
  if (!page.url().match(/.*open.knowledge\/list/)) {
    throw new Error('Failed to transition to article list page.');
  }

  // 日本語に設定を切り替え
  // await page.goto(join(baseUrl, '/lang/select/ja'));

  // 最新記事の一覧を取得
  const latestLocators = await page
    .locator('#knowledgeList > div.knowledge_list > div.knowledge_item')
    .all();

  const latestArticles = await Promise.all(
    latestLocators.map(createArticleExtractor(url)),
  );

  // 人気記事のページに移動
  await page.goto(join(url, '/open.knowledge/show_popularity'));

  // 人気記事の一覧を取得
  const popularLocators = await page
    .locator('#knowledgeList > div.knowledge_list > div.knowledge_item')
    .all();

  const popularArticles = await Promise.all(
    popularLocators.map(createArticleExtractor(url)),
  );

  return { latestArticles, popularArticles };
};

/**
 * いい感じに記事の一覧を作成する
 * @param articles
 */
const generateArticlesText = (articles: ArticleMeta[]) =>
  articles
    .reduce(
      (acc, { no, title, url, author }) => [
        ...acc,
        [`#${no} ${title} ${author}`, url].join('\n'),
      ],
      [] as string[],
    )
    .join('\n');

/**
 * 指定した月のコントリビューションカレンダーを作成する
 * @param articles
 */
const generateContributionGraph = (articles: ArticleMeta[]) =>
  articles
    .reduce(
      (acc) => {
        return acc;
      },
      ['FIXME:'] as string[],
    )
    .join('\n');

/**
 * 取得した情報で記事を出力する
 */
const outputReport = ({
  targetMonth,
  outputDir,
  template,
  url,
  latestArticles,
  popularArticles,
}: {
  targetMonth: string;
  outputDir: string;
  template: string;
  url: string;
  latestArticles: ArticleMeta[];
  popularArticles: ArticleMeta[];
}) => {
  // 先月の記事のみ抽出する
  const targetMonthArticles = latestArticles.filter(
    (article) =>
      formatMonth(
        parse(article.postedDate, 'yyyy/MM/dd H:mm', new Date()),
        'yyyyMM',
      ) === targetMonth,
  );

  const content = readFileSync(template, 'utf-8')
    .toString()
    // タグを置き換える
    .replaceAll('@knowledgeUrl@', url)
    .replaceAll(
      '@targetMonth@',
      formatMonth(parseMonth(targetMonth, 'yyyyMM'), 'yyyy年MM月'),
    )
    .replaceAll(
      '@targetMonthArticles@',
      generateArticlesText(targetMonthArticles),
    )
    .replaceAll(
      '@popularArticles@',
      // NOTE: TOP5のみ
      generateArticlesText(popularArticles.slice(0, 5)),
    )
    .replaceAll(
      '@contributionGraph@',
      generateContributionGraph(targetMonthArticles),
    );

  // ファイルを出力する
  const filename = resolve(
    join(
      '.',
      outputDir,
      `${targetMonth}-report.${format(new Date(), 'yyyyMMddHHmmss')}.txt`,
    ),
  );

  writeFileSync(filename, content);
};

/**
 * コマンドライン引数をいい感じに取得する
 */
const getOptions = () =>
  new Command()
    .requiredOption(
      '-m, --month [target month]',
      'Specify the output target month.',
    )
    .option(
      '-t, --template [use template file]',
      'Specify the template file.',
      'templates/template.sample.txt',
    )
    .option(
      '-o, --output [output file directory]',
      'Specify the output destination.',
      '/tmp',
    )
    .option('-h, --headless', 'Running in headless mode.', false)
    .parse(process.argv)
    .opts();

/**
 * 最初に呼び出される関数
 */
const main = async () => {
  // .envファイルを読み込む
  config();

  const targetMonth: string = getOptions()['month'];
  if (!isValid(parseMonth(targetMonth, 'yyyyMM'))) {
    throw new Error('Specify the month in the format "yyyyMM".');
  }

  const headless = !!getOptions()['headless'];
  const browser = await chromium.launch({
    headless,
  });

  try {
    const page = await browser.newPage();

    const { latestArticles, popularArticles } = await scribePage(page, {
      url: process.env.BASE_URL,
      id: process.env.USERNAME,
      password: process.env.PASSWORD,
    });

    const targetMonth: string = getOptions()['month'];
    const template: string = getOptions()['template'];
    const outputDir: string = getOptions()['output'];

    outputReport({
      url: process.env.BASE_URL,
      template,
      outputDir,
      targetMonth,
      latestArticles,
      popularArticles,
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await browser.close();
  }
};
main();
