// Cloudflare Pages Function: The Odds API 중계(프록시)
// - API 키를 숨기고(환경변수 ODDS_API_KEY), 응답을 캐싱해 무료 한도(월 500)를 아낍니다.
// 호출 예: /api/sports?type=odds&sport=baseball   /api/sports?type=scores&sport=baseball

const ODDS_HOST = 'https://api.the-odds-api.com/v4';

// 종목 → 리그(시즌에 맞게 여기만 바꾸면 됩니다)
const SPORT_KEYS = {
  baseball:   'baseball_mlb',
  basketball: 'basketball_nba',
  soccer:     'soccer_usa_mls',
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'odds';
  const sportParam = url.searchParams.get('sport') || 'baseball';
  const sportKey = SPORT_KEYS[sportParam] || sportParam;
  const apiKey = env.ODDS_API_KEY;

  if (!apiKey) {
    return json({ error: 'NO_API_KEY',
      message: 'ODDS_API_KEY 환경변수가 아직 설정되지 않았습니다. Cloudflare Pages 설정에서 등록해 주세요.' }, 200);
  }

  // 캐시 키에는 apiKey를 넣지 않음
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/sports?type=${type}&sport=${sportKey}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstream, ttl;
  if (type === 'scores') {
    upstream = `${ODDS_HOST}/sports/${sportKey}/scores/?apiKey=${apiKey}&daysFrom=3`;
    ttl = 120;            // 2분 캐시
  } else {
    upstream = `${ODDS_HOST}/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=decimal`;
    ttl = 300;            // 5분 캐시
  }

  let resp;
  try {
    resp = await fetch(upstream, { cf: { cacheTtl: 0 } });
  } catch (e) {
    return json({ error: 'FETCH_FAILED', message: String(e) }, 200);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return json({ error: 'UPSTREAM_' + resp.status, message: text || resp.statusText }, 200);
  }

  let data;
  try { data = await resp.json(); } catch (e) { return json({ error: 'BAD_JSON', message: String(e) }, 200); }

  let events;
  if (type === 'scores') {
    events = (data || []).map(ev => ({
      id: ev.id, completed: !!ev.completed,
      home: ev.home_team, away: ev.away_team, commence: ev.commence_time,
      homeScore: scoreOf(ev, ev.home_team),
      awayScore: scoreOf(ev, ev.away_team),
    }));
  } else {
    events = (data || []).map(ev => {
      const odds = pickOdds(ev);
      return odds ? { id: ev.id, home: ev.home_team, away: ev.away_team, commence: ev.commence_time, odds } : null;
    }).filter(Boolean);
  }

  const remaining = resp.headers.get('x-requests-remaining');
  const body = JSON.stringify({ sport: sportParam, sportKey, remaining, events });
  const out = new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${ttl}`,
    },
  });
  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// 한 경기에서 대표 북메이커(첫 번째)의 승/무/패 배당 추출
function pickOdds(ev) {
  const bk = (ev.bookmakers || [])[0];
  if (!bk) return null;
  const m = (bk.markets || []).find(x => x.key === 'h2h');
  if (!m) return null;
  const o = { home: null, away: null, draw: null };
  for (const oc of (m.outcomes || [])) {
    if (oc.name === ev.home_team) o.home = oc.price;
    else if (oc.name === ev.away_team) o.away = oc.price;
    else o.draw = oc.price; // 'Draw'
  }
  return (o.home && o.away) ? o : null;
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
