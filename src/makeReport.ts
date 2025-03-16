import { startOfMonth, lastDayOfMonth, getDate, compareAsc } from 'date-fns';
import { readFileSync } from 'node:fs';
import { ArticleMeta } from './article';
import { changeMonthFormat, parseDate } from './date';

/**
 * いい感じに記事の一覧を作成する
 * @param articles
 */
const generateArticlesText = (
  articles: ArticleMeta[],
  shouldMarkdownLink: boolean,
) =>
  articles
    .reduce(
      (acc, { no, title, url, author }) => [
        ...acc,
        shouldMarkdownLink
          ? `・ [#${no} ${title}](${url}) by ${author}`
          : [`#${no} ${title} by ${author}`, url].join('\n'),
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

  return [title, '```', ...metrics, '```'].join('\n');
};

/**
 * 取得した情報でレポート用のテキストを構築する
 */
export const makeReport = ({
  targetMonth,
  template,
  url,
  latestArticles,
  popularArticles,
  shouldMarkdownLink,
}: {
  targetMonth: string;
  template: string;
  url: string;
  latestArticles: ArticleMeta[];
  popularArticles: ArticleMeta[];
  shouldMarkdownLink: boolean;
}) => {
  // 当月の記事のみ抽出する
  const targetMonthArticles = latestArticles
    .filter(
      ({ postedDate }) =>
        targetMonth ===
        changeMonthFormat(postedDate, 'yyyy/MM/dd H:mm', 'yyyyMM'),
    )
    .sort(({ postedDate: a }, { postedDate: b }) =>
      compareAsc(
        parseDate(a, 'yyyy/MM/dd H:mm'),
        parseDate(b, 'yyyy/MM/dd H:mm'),
      ),
    );

  const targetMonthArticleNumbers = new Set(
    targetMonthArticles.map(({ no }) => no),
  );

  // 人気記事から当月の記事を除いたTOP5を取得する
  const top5PopularArticles = popularArticles
    .filter(({ no }) => !targetMonthArticleNumbers.has(no))
    .slice(0, 5);

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
      generateArticlesText(targetMonthArticles, shouldMarkdownLink),
    )
    .replaceAll(
      '@popularArticles@',
      // NOTE: TOP5のみ
      generateArticlesText(top5PopularArticles, shouldMarkdownLink),
    )
    .replaceAll(
      '@contributionGraph@',
      generateContributionGraph(targetMonth, targetMonthArticles),
    );

  return content;
};
