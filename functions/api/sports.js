// Cloudflare Pages Function: The Odds API 중계(프록시)
// - API 키를 숨기고(환경변수 ODDS_API_KEY), 응답을 캐싱해 무료 한도(월 500)를 아낍니다.
// - 종목 1개 안에 여러 리그를 묶어서 반환(각 경기에 league 표시).
// 호출 예: /api/sports?type=odds&sport=baseball   /api/sports?type=scores&sport=soccer

const ODDS_HOST = 'https://api.the-odds-api.com/v4';

// 종목 → 리그 묶음(시즌에 맞게 여기만 바꾸면 됩니다)
const SPORT_GROUPS = {
  baseball: [
    { key: 'baseball_mlb', title: 'MLB' },
    { key: 'baseball_npb', title: 'NPB (일본)' },
  ],
  basketball: [
    { key: 'basketball_nba',  title: 'NBA' },
    { key: 'basketball_wnba', title: 'WNBA' },
  ],
  soccer: [
    { key: 'soccer_brazil_campeonato',            title: '브라질 세리에 A' },
    { key: 'soccer_conmebol_copa_libertadores',   title: '코파 리베르타도레스' },
    { key: 'soccer_conmebol_copa_sudamericana',   title: '코파 수다메리카나' },
  ],
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'odds';
  const sportParam = url.searchParams.get('sport') || 'baseball';
  const groups = SPORT_GROUPS[sportParam];
  const apiKey = env.ODDS_API_KEY;

  if (!apiKey) {
    return json({ error: 'NO_API_KEY',
      message: 'ODDS_API_KEY 환경변수가 아직 설정되지 않았습니다.' });
  }
  if (!groups) return json({ error: 'BAD_SPORT', message: '알 수 없는 종목입니다.' });

  // 캐시(apiKey 제외)
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/sports?type=${type}&sport=${sportParam}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const ttl = type === 'scores' ? 120 : 300;
  const events = [];
  let remaining = null;

  for (const g of groups) {
    const upstream = type === 'scores'
      ? `${ODDS_HOST}/sports/${g.key}/scores/?apiKey=${apiKey}&daysFrom=3`
      : `${ODDS_HOST}/sports/${g.key}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=decimal`;

    let resp;
    try { resp = await fetch(upstream, { cf: { cacheTtl: 0 } }); } catch (e) { continue; }
    if (!resp.ok) continue;   // 비시즌·잘못된 키 등은 건너뜀

    const r = resp.headers.get('x-requests-remaining');
    if (r != null) remaining = r;

    let data;
    try { data = await resp.json(); } catch (e) { continue; }

    if (type === 'scores') {
      (data || []).forEach(ev => events.push({
        id: ev.id, completed: !!ev.completed, league: g.title,
        home: ev.home_team, away: ev.away_team, commence: ev.commence_time,
        homeScore: scoreOf(ev, ev.home_team),
        awayScore: scoreOf(ev, ev.away_team),
      }));
    } else {
      (data || []).forEach(ev => {
        const odds = pickOdds(ev);
        if (odds) events.push({
          id: ev.id, league: g.title,
          home: ev.home_team, away: ev.away_team, commence: ev.commence_time, odds,
        });
      });
    }
  }

  const body = JSON.stringify({ sport: sportParam, remaining, events });
  const out = new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${ttl}`,
    },
  });
  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// 한 경기에서 승무패(h2h)·핸디캡(spreads)·언더오버(totals) 배당 추출
// 마켓마다 그것을 제공하는 첫 북메이커를 찾아 사용(커버리지 향상)
function pickOdds(ev) {
  const bks = ev.bookmakers || [];
  const findMarket = (key) => {
    for (const bk of bks) {
      const m = (bk.markets || []).find(x => x.key === key);
      if (m) return m;
    }
    return null;
  };
  const out = {};

  const h2h = findMarket('h2h');
  if (h2h) {
    const o = { home: null, away: null, draw: null };
    for (const oc of (h2h.outcomes || [])) {
      if (oc.name === ev.home_team) o.home = oc.price;
      else if (oc.name === ev.away_team) o.away = oc.price;
      else o.draw = oc.price; // 'Draw'
    }
    if (o.home && o.away) out.h2h = o;
  }

  const sp = findMarket('spreads');
  if (sp) {
    const o = { home: null, away: null };
    for (const oc of (sp.outcomes || [])) {
      if (oc.name === ev.home_team) o.home = { price: oc.price, point: oc.point };
      else if (oc.name === ev.away_team) o.away = { price: oc.price, point: oc.point };
    }
    if (o.home && o.away) out.spreads = o;
  }

  const tot = findMarket('totals');
  if (tot) {
    const o = { over: null, under: null };
    for (const oc of (tot.outcomes || [])) {
      if (oc.name === 'Over') o.over = { price: oc.price, point: oc.point };
      else if (oc.name === 'Under') o.under = { price: oc.price, point: oc.point };
    }
    if (o.over && o.under) out.totals = o;
  }

  return out.h2h ? out : null;   // 최소 승무패는 있어야 표시
}

function scoreOf(ev, team) {
  if (!ev.scores) return null;
  const s = ev.scores.find(x => x.name === team);
  return s ? Number(s.score) : null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
