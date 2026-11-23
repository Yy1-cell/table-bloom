// "Why Table & Bloom?" — the psychology behind the app, for users and for anyone reviewing the project.
// Opened from the sign-in page, the first intro card and the profile page. Text lives here (long, both languages).
import { openSheet } from "../ui.js";
import { getLang } from "../i18n.js";
import { esc } from "../util.js";

const TEXT = {
  en: {
    title: "Why Table & Bloom?",
    lead: "Table & Bloom is a developmental psychology and education project. Its goal is to help young adults, international students and newcomers feel less lonely and more connected, by making it easy to share a meal with others.",
    problemH: "The problem",
    problem: [
      "Many people aged 18–29 move for school or work and lose their old social circle (emerging adulthood, Arnett, 2000).",
      "International students and newcomers also face acculturation stress and often feel lonely (Berry, 1997).",
      "Wanting company is not enough: reaching out to strangers feels risky, and planning a meal with friends takes many messages.",
    ],
    ideaH: "The idea: belonging through shared meals",
    idea: [
      "Belonging is a basic human need; lacking it harms well-being (Baumeister & Leary, 1995).",
      "Eating together is one of the oldest ways people bond. People who eat with others more often report feeling closer to others and more satisfied with life (Dunbar, 2017).",
      "A meal is a structured, low-pressure setting: there is something to do, something to talk about, and a clear end time. This helps shy or socially anxious people take a first step.",
    ],
    mapH: "How each part of the app connects to psychology",
    map: [
      ["Meet new people at a table", "Belonging; weak ties: even casual contact with acquaintances lifts mood and belonging (Granovetter, 1973; Sandstrom & Dunn, 2014)."],
      ["You choose who joins, and can leave or block any time", "Autonomy, one of the three basic needs in self-determination theory (Deci & Ryan, 2000)."],
      ["Host a table in two steps; friends tables combine everyone's cravings", "Competence; fewer choices and steps reduce choice overload (Iyengar & Lepper, 2000)."],
      ["Meet in public, 18+, no home address shown, details only after joining", "Feeling safe lowers the perceived risk of meeting strangers, so people are more willing to try."],
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
    lead: "饭局（Table & Bloom）是一个发展心理学与教育方向的项目。目的是帮助年轻人、留学生和刚到新城市的人减少孤独感、建立归属感，方式很简单：让一起吃顿饭这件事变得容易。",
    problemH: "要解决的问题",
    problem: [
      "18–29 岁的人常因为上学、工作搬到新城市，原来的社交圈断开了（成年初显期，Arnett, 2000）。",
      "留学生和新移民还要面对文化适应压力，更容易感到孤独（Berry, 1997）。",
      "想有人陪不等于能找到人：主动找陌生人让人不安，和朋友约饭又要来回商量很久。",
    ],
    ideaH: "思路：通过一起吃饭建立归属感",
    idea: [
      "归属感是人的基本需要，缺少它会影响身心健康（Baumeister & Leary, 1995）。",
      "一起吃饭是人类最古老的联结方式之一。经常和别人一起吃饭的人，和他人更亲近，对生活也更满意（Dunbar, 2017）。",
      "吃饭是一个有结构、压力小的场景：有事可做、有话题可聊、时间有限。慢热或有社交焦虑的人也更容易迈出第一步。",
    ],
    mapH: "每个功能和心理学的联系",
    map: [
      ["和新朋友一起吃饭", "归属感；弱关系：和不太熟的人轻松互动，也能提升当天的心情和归属感（Granovetter, 1973；Sandstrom & Dunn, 2014）。"],
      ["由你决定谁加入，随时可以退出或屏蔽", "自主感，自我决定理论的三大基本心理需要之一（Deci & Ryan, 2000）。"],
      ["两步发起饭局；朋友局自动合并大家的口味", "胜任感；减少选项和步骤，避免“选择过载”（Iyengar & Lepper, 2000）。"],
      ["公共场所见面、仅限 18 岁以上、不显示住址、加入后才看到细节", "安全感降低了和陌生人见面的感知风险，让人更愿意尝试。"],
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
  "Iyengar, S. S., & Lepper, M. R. (2000). When choice is demotivating. Journal of Personality and Social Psychology, 79(6), 995–1006.",
  "Sandstrom, G. M., & Dunn, E. W. (2014). Social interactions and well-being: The surprising power of weak ties. Personality and Social Psychology Bulletin, 40(7), 910–922.",
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
