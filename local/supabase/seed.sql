-- ============================================================================
-- EyesInvest — Phase 1 seed data
--
-- Reference data: 2 markets, 3 currencies, 20 US + 10 HK stocks, with aliases
-- in English / Traditional Chinese / Simplified Chinese.
-- ============================================================================

-- ===== Markets =====
insert into public.ey_markets (code, name_en, name_zh_hk, name_zh_cn, timezone, open_time, close_time) values
  ('US', 'United States',  '美國',     '美国',    'America/New_York', '09:30', '16:00'),
  ('HK', 'Hong Kong',      '香港',     '香港',    'Asia/Hong_Kong',   '09:30', '16:00')
on conflict (code) do nothing;

-- ===== Currencies =====
insert into public.ey_currencies (code, symbol, decimals) values
  ('USD', 'US$', 2),
  ('HKD', 'HK$', 2),
  ('CNY', '¥',   2)
on conflict (code) do nothing;

-- ===== Stocks (US) =====
insert into public.ey_stocks (symbol, name, market, currency, exchange, sector, industry, is_active) values
  ('AAPL',  'Apple Inc.',                       'US', 'USD', 'NASDAQ', 'Technology',              'Consumer Electronics',        true),
  ('MSFT',  'Microsoft Corporation',            'US', 'USD', 'NASDAQ', 'Technology',              'Software',                    true),
  ('NVDA',  'NVIDIA Corporation',               'US', 'USD', 'NASDAQ', 'Technology',              'Semiconductors',              true),
  ('AMZN',  'Amazon.com Inc.',                  'US', 'USD', 'NASDAQ', 'Consumer Cyclical',       'Internet Retail',             true),
  ('GOOGL', 'Alphabet Inc.',                    'US', 'USD', 'NASDAQ', 'Communication Services',  'Internet Content',            true),
  ('META',  'Meta Platforms Inc.',              'US', 'USD', 'NASDAQ', 'Communication Services',  'Social Media',                true),
  ('TSLA',  'Tesla Inc.',                       'US', 'USD', 'NASDAQ', 'Consumer Cyclical',       'Auto Manufacturers',          true),
  ('JPM',   'JPMorgan Chase & Co.',             'US', 'USD', 'NYSE',   'Financial Services',      'Banks',                       true),
  ('BAC',   'Bank of America Corp.',            'US', 'USD', 'NYSE',   'Financial Services',      'Banks',                       true),
  ('XOM',   'Exxon Mobil Corporation',          'US', 'USD', 'NYSE',   'Energy',                  'Oil & Gas',                   true),
  ('CVX',   'Chevron Corporation',              'US', 'USD', 'NYSE',   'Energy',                  'Oil & Gas',                   true),
  ('WMT',   'Walmart Inc.',                     'US', 'USD', 'NYSE',   'Consumer Defensive',      'Discount Stores',             true),
  ('KO',    'The Coca-Cola Company',            'US', 'USD', 'NYSE',   'Consumer Defensive',      'Beverages',                   true),
  ('PEP',   'PepsiCo Inc.',                     'US', 'USD', 'NASDAQ', 'Consumer Defensive',      'Beverages',                   true),
  ('PFE',   'Pfizer Inc.',                      'US', 'USD', 'NYSE',   'Healthcare',              'Drug Manufacturers',          true),
  ('JNJ',   'Johnson & Johnson',                'US', 'USD', 'NYSE',   'Healthcare',              'Pharmaceutical',              true),
  ('V',     'Visa Inc.',                        'US', 'USD', 'NYSE',   'Financial Services',      'Credit Services',             true),
  ('MA',    'Mastercard Incorporated',          'US', 'USD', 'NYSE',   'Financial Services',      'Credit Services',             true),
  ('DIS',   'The Walt Disney Company',          'US', 'USD', 'NYSE',   'Communication Services',  'Entertainment',                true),
  ('NFLX',  'Netflix Inc.',                     'US', 'USD', 'NASDAQ', 'Communication Services',  'Entertainment',                true)
on conflict (symbol, market) do nothing;

-- ===== Stocks (HK) =====
insert into public.ey_stocks (symbol, name, market, currency, exchange, sector, industry, is_active) values
  ('0700.HK', 'Tencent Holdings Ltd.',                  'HK', 'HKD', 'HKEX', 'Communication Services', 'Internet Content',                 true),
  ('9988.HK', 'Alibaba Group Holding Ltd.',             'HK', 'HKD', 'HKEX', 'Consumer Cyclical',      'Internet Retail',                  true),
  ('0005.HK', 'HSBC Holdings plc',                      'HK', 'HKD', 'HKEX', 'Financial Services',     'Banks',                            true),
  ('0941.HK', 'China Mobile Limited',                   'HK', 'HKD', 'HKEX', 'Communication Services', 'Telecom',                          true),
  ('1299.HK', 'AIA Group Limited',                      'HK', 'HKD', 'HKEX', 'Financial Services',     'Insurance',                        true),
  ('0883.HK', 'CNOOC Limited',                          'HK', 'HKD', 'HKEX', 'Energy',                 'Oil & Gas',                        true),
  ('0388.HK', 'Hong Kong Exchanges & Clearing',          'HK', 'HKD', 'HKEX', 'Financial Services',     'Financial Data & Stock Exchanges', true),
  ('2318.HK', 'Ping An Insurance Group',                'HK', 'HKD', 'HKEX', 'Financial Services',     'Insurance',                        true),
  ('3690.HK', 'Meituan',                                'HK', 'HKD', 'HKEX', 'Consumer Cyclical',      'Internet Retail',                  true),
  ('1810.HK', 'Xiaomi Corporation',                     'HK', 'HKD', 'HKEX', 'Technology',             'Consumer Electronics',             true)
on conflict (symbol, market) do nothing;

-- ===== Aliases =====
-- English (universal)
insert into public.ey_stock_aliases (stock_id, alias, locale, source)
select s.id, x.alias, l.locale, 'seed'
from public.ey_stocks s
join (values
  ('AAPL', 'Apple'),
  ('AAPL', 'Apple Inc'),
  ('MSFT', 'Microsoft'),
  ('NVDA', 'NVIDIA'),
  ('AMZN', 'Amazon'),
  ('GOOGL', 'Google'),
  ('GOOGL', 'Alphabet'),
  ('META', 'Facebook'),
  ('TSLA', 'Tesla'),
  ('JPM',  'JPMorgan'),
  ('BAC',  'Bank of America'),
  ('XOM',  'Exxon'),
  ('CVX',  'Chevron'),
  ('WMT',  'Walmart'),
  ('KO',   'Coca-Cola'),
  ('PEP',  'Pepsi'),
  ('PFE',  'Pfizer'),
  ('JNJ',  'Johnson & Johnson'),
  ('V',    'Visa'),
  ('MA',   'Mastercard'),
  ('DIS',  'Disney'),
  ('NFLX', 'Netflix'),
  ('0700.HK', 'Tencent'),
  ('9988.HK', 'Alibaba'),
  ('0005.HK', 'HSBC'),
  ('0941.HK', 'China Mobile'),
  ('1299.HK', 'AIA'),
  ('0883.HK', 'CNOOC'),
  ('0388.HK', 'HKEX'),
  ('2318.HK', 'Ping An'),
  ('3690.HK', 'Meituan'),
  ('1810.HK', 'Xiaomi')
) as x(symbol, alias) on s.symbol = x.symbol
cross join lateral (values ('en'::text)) as l(locale)
on conflict do nothing;

-- Traditional Chinese
insert into public.ey_stock_aliases (stock_id, alias, locale, source)
select s.id, x.alias, 'zh-HK', 'seed'
from public.ey_stocks s
join (values
  ('AAPL',  '蘋果'),
  ('MSFT',  '微軟'),
  ('NVDA',  '輝達'),
  ('AMZN',  '亞馬遜'),
  ('GOOGL', '谷歌'),
  ('META',  '臉書'),
  ('TSLA',  '特斯拉'),
  ('JPM',   '摩根大通'),
  ('BAC',   '美國銀行'),
  ('WMT',   '沃爾瑪'),
  ('KO',    '可口可樂'),
  ('PFE',   '輝瑞'),
  ('JNJ',   '強生'),
  ('DIS',   '迪士尼'),
  ('NFLX',  '網飛'),
  ('0700.HK', '騰訊'),
  ('0700.HK', '騰訊控股'),
  ('9988.HK', '阿里巴巴'),
  ('0005.HK', '匯豐'),
  ('0941.HK', '中國移動'),
  ('1299.HK', '友邦保險'),
  ('0883.HK', '中海油'),
  ('0388.HK', '港交所'),
  ('0388.HK', '香港交易所'),
  ('2318.HK', '中國平安'),
  ('2318.HK', '平安'),
  ('3690.HK', '美團'),
  ('1810.HK', '小米')
) as x(symbol, alias) on s.symbol = x.symbol
on conflict do nothing;

-- Simplified Chinese
insert into public.ey_stock_aliases (stock_id, alias, locale, source)
select s.id, x.alias, 'zh-CN', 'seed'
from public.ey_stocks s
join (values
  ('AAPL',  '苹果'),
  ('MSFT',  '微软'),
  ('NVDA',  '英伟达'),
  ('AMZN',  '亚马逊'),
  ('GOOGL', '谷歌'),
  ('META',  '脸书'),
  ('TSLA',  '特斯拉'),
  ('JPM',   '摩根大通'),
  ('BAC',   '美国银行'),
  ('WMT',   '沃尔玛'),
  ('KO',    '可口可乐'),
  ('PFE',   '辉瑞'),
  ('JNJ',   '强生'),
  ('DIS',   '迪士尼'),
  ('NFLX',  '网飞'),
  ('0700.HK', '腾讯'),
  ('0700.HK', '腾讯控股'),
  ('9988.HK', '阿里巴巴'),
  ('0005.HK', '汇丰'),
  ('0941.HK', '中国移动'),
  ('1299.HK', '友邦保险'),
  ('0883.HK', '中海油'),
  ('0388.HK', '港交所'),
  ('0388.HK', '香港交易所'),
  ('2318.HK', '中国平安'),
  ('2318.HK', '平安'),
  ('3690.HK', '美团'),
  ('1810.HK', '小米')
) as x(symbol, alias) on s.symbol = x.symbol
on conflict do nothing;
