import { config } from 'dotenv';
import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { assertDateFormat } from './date';
import { scrapePage } from './scrapePage';
import { makeReport } from './makeReport';

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
    .option(
      '--markdown',
      'Specify if you want to output article links in markdown format',
      false,
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

  const targetMonth = getOptions()['month'];
  assertDateFormat(
    targetMonth,
    'yyyyMM',
    'Specify the month in the format "yyyyMM".',
  );

  const headless = !!getOptions()['headless'];
  const browser = await chromium.launch({
    headless,
  });

  const page = await browser.newPage();

  try {
    // NOTE: Knowledgeのページをスクレイピングして記事の情報を収集する
    const { latestArticles, popularArticles } = await scrapePage(page, {
      url: process.env.BASE_URL,
      id: process.env.USERNAME,
      password: process.env.PASSWORD,
    });

    const template: string = getOptions()['template'];
    const shouldMarkdownLink = !!getOptions()['markdown'];

    // NOTE: 収集した情報を利用してレポートを成形する
    const report = makeReport({
      url: process.env.BASE_URL,
      template,
      targetMonth,
      latestArticles,
      popularArticles,
      shouldMarkdownLink,
    });

    const outputDir: string = getOptions()['output'];
    const isDryRun = !!getOptions()['dryRun'];

    /** 出力ファイル名 */
    const filename = resolve(
      join('.', outputDir, `${targetMonth}.report.${+new Date()}.txt`),
    );

    if (isDryRun) {
      console.debug('output filename =>', filename);
      console.debug('report => ', report);
      return;
    }

    // ファイルを出力する
    writeFileSync(filename, report);
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
