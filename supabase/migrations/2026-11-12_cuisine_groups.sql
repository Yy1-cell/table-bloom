-- Wider cuisine menu, grouped (Chinese, Japanese/Korean, Asian, Western, casual, sweet & drinks).
-- Safe to re-run. Existing slugs keep their meaning, so saved tables, cravings and rankings stay valid.
alter table public.cuisines add column if not exists grp text not null default 'other';

insert into public.cuisines (slug, name_en, name_zh, emoji, grp, sort) values
  ('hotpot', 'Hot pot', '火锅', '🥘', 'chinese', 1),
  ('sichuan', 'Sichuan', '川菜', '🌶️', 'chinese', 2),
  ('cantonese', 'Cantonese & roast meats', '粤菜·烧腊', '🦆', 'chinese', 3),
  ('dimsum', 'Dim sum', '早茶点心', '🥟', 'chinese', 4),
  ('noodles', 'Noodles & dumplings', '面食饺子', '🍜', 'chinese', 5),
  ('skewers', 'BBQ & skewers', '烧烤串串', '🍢', 'chinese', 6),
  ('hk_cafe', 'HK café', '港式茶餐厅', '🍍', 'chinese', 7),
  ('taiwanese', 'Taiwanese', '台湾菜', '🍚', 'chinese', 8),
  ('regional', 'Other regional Chinese', '湘菜·东北·江浙', '🥢', 'chinese', 9),
  ('japanese', 'Japanese & sushi', '日料·寿司', '🍣', 'japan_korea', 10),
  ('ramen', 'Ramen & udon', '拉面乌冬', '🍥', 'japan_korea', 11),
  ('izakaya', 'Izakaya', '居酒屋', '🏮', 'japan_korea', 12),
  ('korean_bbq', 'Korean BBQ', '韩式烤肉', '🍖', 'japan_korea', 13),
  ('korean', 'Korean', '韩餐·炖锅', '🍲', 'japan_korea', 14),
  ('thai', 'Thai', '泰餐', '🥥', 'asia', 15),
  ('vietnamese', 'Vietnamese', '越南菜', '🥖', 'asia', 16),
  ('indian', 'Indian', '印度菜', '🍛', 'asia', 17),
  ('american', 'American & burgers', '美式·汉堡', '🍔', 'western', 18),
  ('steak', 'Steak & grill', '牛排·扒房', '🥩', 'western', 19),
  ('italian', 'Italian & pasta', '意餐·意面', '🍝', 'western', 20),
  ('pizza', 'Pizza', '披萨', '🍕', 'western', 21),
  ('mexican', 'Mexican', '墨西哥菜', '🌮', 'western', 22),
  ('mediterranean', 'Mediterranean & Middle Eastern', '中东·地中海', '🥙', 'western', 23),
  ('seafood', 'Seafood', '海鲜', '🦞', 'western', 24),
  ('brunch', 'Brunch', '早午餐', '🥞', 'western', 25),
  ('fried_chicken', 'Fried chicken & wings', '炸鸡·鸡翅', '🍗', 'casual', 26),
  ('pub', 'Pub & bar food', '酒馆 Pub', '🍻', 'casual', 27),
  ('buffet', 'Buffet', '自助餐', '🍱', 'casual', 28),
  ('vegetarian', 'Vegetarian & vegan', '素食·轻食', '🥗', 'casual', 29),
  ('cafe', 'Café & light bites', '咖啡轻食', '☕', 'sweet', 30),
  ('bubble_tea', 'Bubble tea', '奶茶', '🧋', 'sweet', 31),
  ('dessert', 'Dessert & bakery', '甜品·烘焙', '🍰', 'sweet', 32),
  ('latin', 'Latin American & South American', '拉美·南美菜', '🦙', 'western', 33)
on conflict (slug) do update set name_en = excluded.name_en, name_zh = excluded.name_zh, emoji = excluded.emoji, grp = excluded.grp, sort = excluded.sort;
