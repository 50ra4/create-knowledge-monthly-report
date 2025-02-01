import { config } from 'dotenv';
import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { isValid, startOfMonth, lastDayOfMonth, getDate } from 'date-fns';
import { changeMonthFormat, parseDate } from './date';
import { ArticleMeta } from './article';
import { scrapePage } from './scrapePage';

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

/**
 * 曜日のラベルの一覧
 */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * 指定した月のコントリビューションカレンダーを作成する
 * @param articles 特定の月に投稿した記事の一覧
 */
const generateContributionGraph = (
  targetMonth: string,
  articles: ArticleMeta[],
) => {
  const title = `${articles.length} contributions in ${changeMonthFormat(targetMonth, 'yyyyMM', 'MMMM yyyy')}`;

  const targetDate = parseDate(targetMonth, 'yyyyMM');
  const startDate = startOfMonth(targetDate);
  const endDate = lastDayOfMonth(targetDate);

  // NOTE: 日付とその日の記事件数のMapを作成
  const contributionPoints = articles
    .map(({ postedDate }) =>
      // NOTE: e.g) 2025/01/02 8:09 -> 2
      getDate(parseDate(postedDate, 'yyyy/MM/dd H:mm')),
    )
    .reduce(
      (acc, day) => acc.set(day, acc.get(day) ?? 0 + 1),
      new Map<number, number>(),
    );

  // NOTE: 7行 * 5列の配列に月の日にちを設定する
  const metrics = Array.from({ length: 7 })
    .map((_, i) =>
      Array.from({ length: 5 }).map(
        // NOTE: 1日が水曜日の場合、最初の日曜日は5日を計算する
        (_, j) => 7 * j - startDate.getDay() + i + 1,
      ),
    )
    .map((days) =>
      days.map((day) =>
        // NOTE: 日付が当月でない（1未満または最終日より先）は「-」、記事がある日は「■」、ない日は「□」
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
  isDryRun,
  targetMonth,
  outputDir,
  template,
  url,
  latestArticles,
  popularArticles,
}: {
  isDryRun: boolean;
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

  if (isDryRun) {
    console.debug('output filename =>', filename);
    console.debug('content => ', content);
    return;
  }

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
    .option('-d, --dryRun', 'Running dry mode.', false)
    .option('--headless', 'Running in headless mode.', false)
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

  const page = await browser.newPage();

  try {
    const { latestArticles, popularArticles } = await scrapePage(page, {
      url: process.env.BASE_URL,
      id: process.env.USERNAME,
      password: process.env.PASSWORD,
    });

    const targetMonth: string = getOptions()['month'];
    const template: string = getOptions()['template'];
    const outputDir: string = getOptions()['output'];
    const isDryRun = !!getOptions()['dryRun'];

    outputReport({
      isDryRun,
      url: process.env.BASE_URL,
      template,
      outputDir,
      targetMonth,
      latestArticles,
      popularArticles,
    });
  } catch (error) {
    console.error(error);
    // NOTE: エラー発生時はスクリーンショットを取得する
    await page.screenshot({
      fullPage: true,
      path: `./tmp/error_${+new Date()}.png`,
    });
    process.exit(1);
  } finally {
    await browser.close();
  }
};
main();
