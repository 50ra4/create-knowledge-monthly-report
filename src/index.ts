import { config } from 'dotenv';
import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { chromium, Locator, Page } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  parse,
  format,
  isValid,
  eachDayOfInterval,
  startOfMonth,
  lastDayOfMonth,
  getDate,
} from 'date-fns';

/** 記事情報のオブジェクト */
type ArticleMeta = {
  no: number;
  title: string;
  url: string;
  author: string;
  postedDate: string;
};

type DateFormat = 'yyyyMM' | 'yyyy年MM月' | 'yyyy-MM' | 'yyyy/MM/dd H:mm';

const parseDate = (s: string, f: DateFormat) => parse(s, f, new Date());

const formatDate = (d: Date, f: DateFormat) => format(d, f);

const changeMonthFormat = (s: string, from: DateFormat, to: DateFormat) =>
  formatDate(parseDate(s, from), to);

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
        [`#${no} ${title} by ${author}`, url].join('\n'),
      ],
      [] as string[],
    )
    .join('\n');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * 指定した月のコントリビューションカレンダーを作成する
 * @param articles
 */
const generateContributionGraph = (
  targetMonth: string,
  articles: ArticleMeta[],
) => {
  const title = `${articles.length} contributions in ${changeMonthFormat(targetMonth, 'yyyyMM', 'yyyy-MM')}`;

  const targetDate = parseDate(targetMonth, 'yyyyMM');
  const postedDays = articles.map(({ postedDate }) =>
    // NOTE: 2025/01/02 -> 2
    getDate(parseDate(postedDate, 'yyyy/MM/dd H:mm')),
  );

  const startDate = startOfMonth(targetDate);
  const endDate = lastDayOfMonth(targetDate);

  const contributionPoints = eachDayOfInterval({
    start: startDate,
    end: endDate,
  })
    // NOTE: 文字列に変換
    .map((date) => getDate(date))
    // NOTE: 日付とその日の記事件数のMapを作成
    .reduce(
      (acc, day) => acc.set(day, postedDays.filter((d) => d === day).length),
      new Map<number, number>(),
    );

  const metrics = Array.from({ length: 7 })
    .map((_, i) =>
      // NOTE: 1日が水曜日の場合、最初の日曜日は5日を計算する
      Array.from({ length: 5 }).map(
        (_, j) => 7 * j - startDate.getDay() + i + 1,
      ),
    )
    .map((days) =>
      days.map((day) =>
        // NOTE: 日付が当月でない（0未満または最終日より先）は「-」、記事がある日は「■」、ない日は「□」
        day < 1 || getDate(endDate) < day
          ? '-'
          : (contributionPoints.get(day) ?? 0) > 0
            ? '■'
            : '□',
      ),
    )
    .map((cells, i) => [WEEKDAYS[i], ...cells].join(' '));

  return [title, ...metrics].join('\n');
};

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
  // 当月の記事のみ抽出する
  const targetMonthArticles = latestArticles.filter(
    ({ postedDate }) =>
      targetMonth ===
      changeMonthFormat(postedDate, 'yyyy/MM/dd H:mm', 'yyyyMM'),
  );

  const content = readFileSync(template, 'utf-8')
    .toString()
    // タグを置き換える
    .replaceAll('@knowledgeUrl@', url)
    .replaceAll(
      '@targetMonth@',
      changeMonthFormat(targetMonth, 'yyyyMM', 'yyyy年MM月'),
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
      generateContributionGraph(targetMonth, targetMonthArticles),
    );

  // ファイルを出力する
  const filename = resolve(
    join('.', outputDir, `${targetMonth}-report.${+new Date()}.txt`),
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
  if (!isValid(parseDate(targetMonth, 'yyyyMM'))) {
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
