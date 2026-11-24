// "Why Table & Bloom?" — the psychology behind the app, for users and for anyone reviewing the project.
// Opened from the sign-in page, the first intro card and the profile page. Text lives here (long, both languages).
import { openSheet } from "../ui.js";
import { getLang } from "../i18n.js";
import { esc } from "../util.js";

const TEXT = {
  en: {
    title: "Why Table & Bloom?",
    lead: "Table & Bloom is a developmental psychology and education project with two goals: help young adults, international students and newcomers feel less lonely by meeting new people over a meal, and take the stress out of deciding where to eat with friends.",
    problemH: "Goal 1: less loneliness, by meeting new people",
    problem: [
      "Many people aged 18–29 move for school or work and lose their old social circle (emerging adulthood, Arnett, 2000). International students and newcomers also face acculturation stress (Berry, 1997).",
      "Belonging is a basic human need; lacking it harms well-being (Baumeister & Leary, 1995). But reaching out to strangers feels risky and awkward.",
      "A shared meal is a structured, low-pressure setting: something to do, something to talk about, a clear end time. People who eat with others more often feel closer to others and more satisfied with life (Dunbar, 2017).",
      "Friendship needs repeated time together: roughly 50 hours to go from acquaintance to casual friend (Hall, 2019). So the app helps people meet again (“eat together again”).",
    ],
    ideaH: "Goal 2: less decision stress, when eating with friends",
    idea: [
      "Planning a meal with friends means many options, everyone's tastes and food needs, and who lives where. It often ends in a long group chat or “whatever, you decide”, with one person carrying the decision.",
      "People who try to find the very best option tend to feel less happy and more regret (Schwartz et al., 2002). Too many options can make choosing harder, though the evidence depends on the situation (Iyengar & Lepper, 2000; Scheibehenne et al., 2010).",
      "So the app narrows the choice for the group: each person adds where they start and what they feel like eating, the app suggests a few places that fit the most people and are fair to reach, friends can propose, and the host confirms in one tap.",
    ],
    mapH: "How each part of the app connects to psychology",
    map: [
      ["Meet new people at a table", "Belonging; weak ties: even casual contact with acquaintances lifts mood and belonging (Granovetter, 1973; Sandstrom & Dunn, 2014)."],
      ["You choose who joins, and can leave or block any time", "Autonomy, one of the three basic needs in self-determination theory (Deci & Ryan, 2000)."],
      ["Host a table in two steps; friends tables combine everyone's cravings", "Competence; fewer steps and a short, fair list make the group decision easier (Schwartz et al., 2002)."],
      ["Meet at real restaurants, 18+, at least 3 people, no starting points or home addresses shown to strangers, table rules everyone agrees to, a 🛡️ Safety button and a private “did you feel safe?” after the meal", "Feeling safe lowers the perceived risk of meeting strangers, so people are more willing to try. Clear shared rules (social norms) set expectations for how people behave."],
      ["Communities: new in town, Mandarin speakers, slow to warm up, LGBTQ+ friendly, women & non-binary", "Affinity spaces help people who are in a minority position feel they belong and feel safe, which eases minority stress (Meyer, 2003). Most tables stay open to everyone, balancing bonding within a group with bridging across groups (Putnam, 2000)."],
      ["30-second check-in after the meal and “eat together again”", "Reflection on positive social experiences; repeated contact turns one meal into lasting relationships (relatedness)."],
    ],
    gainH: "What you get",
    gain: [
      "Company for a meal, even when you're new in town.",
      "Less back-and-forth when eating with friends, and a place that's fair for everyone to reach.",
      "Over time, regular meal buddies and a stronger sense of belonging.",
    ],
    refsH: "References",
    note: "This app is not therapy or a mental health service. If you are struggling, please reach out to a counsellor or a support line.",
  },
  zh: {
    title: "为什么做饭局？",
    lead: "饭局（Table & Bloom）是一个发展心理学与教育方向的项目，有两个目标：一是帮助年轻人、留学生和刚到新城市的人，通过一起吃饭认识新朋友、减少孤独感；二是减轻和朋友约饭时“吃什么、去哪吃”的决策负担。",
    problemH: "目标一：认识新朋友，减少孤独感",
    problem: [
      "18–29 岁的人常因为上学、工作搬到新城市，原来的社交圈断开了（成年初显期，Arnett, 2000）。留学生和新移民还要面对文化适应压力（Berry, 1997）。",
      "归属感是人的基本需要，缺少它会影响身心健康（Baumeister & Leary, 1995）。但主动找陌生人让人不安、尴尬。",
      "一起吃饭是有结构、压力小的场景：有事可做、有话题可聊、时间有限。经常和别人一起吃饭的人，和他人更亲近，对生活也更满意（Dunbar, 2017）。",
      "友谊需要一次次相处：从认识到普通朋友，大约要一起度过 50 小时（Hall, 2019）。所以 app 用“想再一起吃”帮大家再见面。",
    ],
    ideaH: "目标二：和朋友约饭，减少决策负担",
    idea: [
      "和朋友约饭要考虑很多选项、每个人的口味和饮食需要、谁住在哪里。常常变成群里聊半天，或者一句“随便，你定吧”，最后一个人扛下所有决定。",
      "总想挑出“最好”选项的人，往往幸福感更低、后悔更多（Schwartz et al., 2002）。选项太多可能让人更难决定，不过这要看具体情境（Iyengar & Lepper, 2000；Scheibehenne et al., 2010）。",
      "所以 app 帮大家把选择缩小：每个人填出发地和想吃的，app 推荐几家最多人想吃、大家过去都公平的店，朋友可以提议，发起人一键定下。",
    ],
    mapH: "每个功能和心理学的联系",
    map: [
      ["和新朋友一起吃饭", "归属感；弱关系：和不太熟的人轻松互动，也能提升当天的心情和归属感（Granovetter, 1973；Sandstrom & Dunn, 2014）。"],
      ["由你决定谁加入，随时可以退出或屏蔽", "自主感，自我决定理论的三大基本心理需要之一（Deci & Ryan, 2000）。"],
      ["两步发起饭局；朋友局自动合并大家的口味", "胜任感；更少的步骤和一份简短、公平的推荐清单，让多人决定更轻松（Schwartz et al., 2002）。"],
      ["在真实餐厅见面、仅限 18 岁以上、至少 3 人、陌生人看不到你的出发地和住址、所有人都同意饭局守则、🛡️ 安全按钮、饭后私下问“你感到安全吗”", "安全感降低了和陌生人见面的感知风险，让人更愿意尝试；清楚的共同守则（社会规范）让每个人知道该怎么做。"],
      ["社群局：刚到这座城市、说普通话、慢热友好、LGBTQ+ 友好、女生和非二元", "同类群体的空间让处于少数位置的人更有归属感和安全感，缓解少数群体压力（Meyer, 2003）。大多数饭局仍对所有人开放，兼顾群体内部的紧密联系和跨群体的桥接（Putnam, 2000）。"],
      ["吃完 30 秒写感受、标记“想再一起吃”", "对积极社交经历的反思；多次接触让一顿饭变成长期的关系（关联感）。"],
    ],
    gainH: "你能得到什么",
    gain: [
      "刚到一座城市，也能找到人一起吃饭。",
      "和朋友约饭不用来回商量，推荐的餐厅对每个人都公平。",
      "慢慢有固定的饭搭子，更有归属感。",
    ],
    refsH: "参考文献",
    note: "这个 app 不是心理治疗或心理健康服务。如果你最近很难受，请联系心理咨询师或支持热线。",
  },
};

const REFS = [
  "Arnett, J. J. (2000). Emerging adulthood. American Psychologist, 55(5), 469–480.",
  "Baumeister, R. F., & Leary, M. R. (1995). The need to belong. Psychological Bulletin, 117(3), 497–529.",
  "Berry, J. W. (1997). Immigration, acculturation, and adaptation. Applied Psychology, 46(1), 5–34.",
  "Deci, E. L., & Ryan, R. M. (2000). The “what” and “why” of goal pursuits. Psychological Inquiry, 11(4), 227–268.",
  "Dunbar, R. I. M. (2017). Breaking bread: The functions of social eating. Adaptive Human Behavior and Physiology, 3(3), 198–211.",
  "Granovetter, M. S. (1973). The strength of weak ties. American Journal of Sociology, 78(6), 1360–1380.",
  "Hall, J. A. (2019). How many hours does it take to make a friend? Journal of Social and Personal Relationships, 36(4), 1278–1296.",
  "Iyengar, S. S., & Lepper, M. R. (2000). When choice is demotivating. Journal of Personality and Social Psychology, 79(6), 995–1006.",
  "Meyer, I. H. (2003). Prejudice, social stress, and mental health in lesbian, gay, and bisexual populations. Psychological Bulletin, 129(5), 674–697.",
  "Putnam, R. D. (2000). Bowling alone: The collapse and revival of American community. Simon & Schuster.",
  "Sandstrom, G. M., & Dunn, E. W. (2014). Social interactions and well-being: The surprising power of weak ties. Personality and Social Psychology Bulletin, 40(7), 910–922.",
  "Scheibehenne, B., Greifeneder, R., & Todd, P. M. (2010). Can there ever be too many options? A meta-analytic review of choice overload. Journal of Consumer Research, 37(3), 409–425.",
  "Schwartz, B., Ward, A., Monterosso, J., Lyubomirsky, S., White, K., & Lehman, D. R. (2002). Maximizing versus satisficing: Happiness is a matter of choice. Journal of Personality and Social Psychology, 83(5), 1178–1197.",
];

export function aboutHTML() {
  const x = TEXT[getLang() === "zh" ? "zh" : "en"];
  const ul = (a) => `<ul class="about-list">${a.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`;
  return `
    <h2>🌱 ${esc(x.title)}</h2>
    <p class="about-lead">${esc(x.lead)}</p>
    <h3>${esc(x.problemH)}</h3>${ul(x.problem)}
    <h3>${esc(x.ideaH)}</h3>${ul(x.idea)}
    <h3>${esc(x.mapH)}</h3>
    <div class="about-map">${x.map.map(([f, p]) => `<div class="about-row"><strong>${esc(f)}</strong><span>${esc(p)}</span></div>`).join("")}</div>
    <h3>${esc(x.gainH)}</h3>${ul(x.gain)}
    <details class="about-refs"><summary>${esc(x.refsH)}</summary><ol>${REFS.map((r) => `<li>${esc(r)}</li>`).join("")}</ol></details>
    <p class="hint">${esc(x.note)}</p>`;
}

export function openAbout() {
  const x = TEXT[getLang() === "zh" ? "zh" : "en"];
  return openSheet({ html: aboutHTML(), label: x.title, className: "about-sheet" });
}
