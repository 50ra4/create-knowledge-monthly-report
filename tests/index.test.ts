import { test, expect, Locator } from '@playwright/test';
import { config } from 'dotenv';
import { join } from 'node:path';

config();

test('create knowledge monthly report', async ({ page }) => {
  // Headerの設定
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ja',
  });

  // ログインページに移動
  await page.goto(join(process.env.BASE_URL, '/'));

  // ページ遷移が正常か？
  await expect(page).toHaveTitle(/Knowledge/);

  // IDとPassword入力
  await page.getByPlaceholder('ID').fill(process.env.USERNAME);
  await page.getByPlaceholder('Password').fill(process.env.PASSWORD);

  // ログインボタンを押下
  await page.getByRole('button', { name: /Sign In/ }).click();

  // ログイン後画面に遷移したことを確認
  await expect(page).toHaveURL(/.*open.knowledge\/list/);

  // 日本語に設定を切り替え
  await page.goto(join(process.env.BASE_URL, '/lang/select/ja'));

  // 最新記事の一覧を取得
  const locators = await page
    .locator('#knowledgeList > div.knowledge_list > div.knowledge_item')
    .all();

  const latestArticles = await Promise.all(locators.map(loadArticleInfo));
  console.log('latest', latestArticles.at(0));
});

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
const loadArticleInfo = async (locator: Locator): Promise<ArticleMeta> => {
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

  const url = join(
    process.env.BASE_URL,
    ...(hrefText ?? '').split('?')[0].split('/').slice(2),
    // NOTE: クエリパラメータを外し、先頭のパスパラメータを外す
    // input: /foo/aaaaa/bbbb/cccc?=...
    // expect: aaaa,bbbb,cccc
  );
  const no = +(numberText ?? '').trim().slice(1);
  const title = (titleText ?? '').replace(`#${no}`, '').trim();

  // NOTE: '[未読] aaaa bbbb が 2024/12/30 12:32 に投稿' となっているので、日時のみを取得する
  const postedDate =
    (postDateText ?? '').match(/\d{4}\/\d{2}\/\d{2} \d{1,2}:\d{2}/)?.[0] ?? '';

  return {
    url,
    no,
    title,
    author: authorText ?? '',
    postedDate,
  };
};
