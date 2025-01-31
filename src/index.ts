import { config } from 'dotenv';
import { Command } from 'commander';
import { join } from 'node:path';
import { chromium, Locator, Page } from 'playwright';

/** 記事情報のオブジェクト */
type ArticleMeta = {
  no: number;
  title: string;
  url: string;
  author: string;
  postedDate: string;
};

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
  const locators = await page
    .locator('#knowledgeList > div.knowledge_list > div.knowledge_item')
    .all();

  const latestArticles = await Promise.all(
    locators.map(createArticleExtractor(url)),
  );

  return { latestArticles };
};

/**
 * コマンドライン引数をいい感じに取得する
 */
const getOptions = () =>
  new Command()
    .option('-h, --headless', 'Running in headless mode.', false)
    .parse(process.argv)
    .opts();

/**
 * 最初に呼び出される関数
 */
const main = async () => {
  // .envファイルを読み込む
  config();

  const headless = !!getOptions()['headless'];

  const browser = await chromium.launch({
    headless,
  });

  try {
    const page = await browser.newPage();

    const { latestArticles } = await scribePage(page, {
      url: process.env.BASE_URL,
      id: process.env.USERNAME,
      password: process.env.PASSWORD,
    });

    console.log('latest', latestArticles.at(0));
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await browser.close();
  }
};
main();
