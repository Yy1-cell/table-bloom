"""End-to-end smoke test for Table & Bloom (demo mode, no network to Supabase).

Run:  pip install playwright && python -m playwright install chromium
      python3 tests/e2e/smoke.py

It starts a local static server, opens the app in headless Chromium with
config.js replaced by {} (so the app runs in demo mode on localStorage),
then walks the main flows and checks:
  * no JavaScript errors on any screen
  * no untranslated string keys (e.g. "td2.where") visible
  * no horizontal overflow on a phone-width screen
  * safety rules: women's table forces "request to join", public tables need
    >= 3 seats and a real restaurant, table rules must be ticked
  * XSS: a table title containing HTML is shown as text, never executed
Exits with code 1 if any check fails.
"""
import asyncio, functools, http.server, os, re, socket, sys, threading
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOTS = os.path.join(os.path.dirname(__file__), "screenshots")
KEY_PREFIX = r"(gd|cr2?|td2?|com|comFor|sf|cd|ln|err|wl|tip|pf|disc2?|card|auth2?|map|fb|rep|jm|aud|tag|oc|fm|vt|cg|chip|sort|loc|mine|jr|about|dt|diet|badge|common|nav)"
RAW_KEY = re.compile(r"\b" + KEY_PREFIX + r"\.[a-zA-Z_][\w]*\b")
fails = []


def check(ok, msg):
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok:
        fails.append(msg)


def serve():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{port}"


async def new_page(b, base, lang, w=390, h=844):
    pg = await b.new_page(viewport={"width": w, "height": h})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text
          and "ERR_" not in m.text and errs.append(m.text))
    await pg.route("**/config.js", lambda r: r.fulfill(body="window.TB_CONFIG={};", content_type="application/javascript"))
    await pg.add_init_script(f"try{{localStorage.setItem('tb.lang','{lang}')}}catch(e){{}}")
    return pg, errs


async def screen_ok(pg, name):
    await pg.wait_for_timeout(900)
    txt = await pg.evaluate("document.body.innerText")
    keys = sorted(set(m.group(0) for m in RAW_KEY.finditer(txt)))
    over = await pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    os.makedirs(SHOTS, exist_ok=True)
    await pg.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=True)
    check(not keys, f"{name}: no raw string keys {keys if keys else ''}")
    check(over <= 2, f"{name}: no sideways scroll (overflow {over}px)")


async def sign_in_guest(pg, base):
    await pg.goto(base + "/#auth")
    await pg.wait_for_timeout(1000)
    await pg.click("[data-go=meet]")
    await pg.check("#a-age"); await pg.click("#a-guest"); await pg.wait_for_timeout(1200)
    await pg.fill("#pf-name", "Tester"); await pg.click("#pf [type=submit]"); await pg.wait_for_timeout(1000)
    await pg.evaluate("localStorage.setItem('tb.loc', JSON.stringify({lat:43.6629,lng:-79.3957,label:'U of T',cc:'CA'}))")


async def screens(b, base, lang):
    print(f"\n[screens · {lang}]")
    pg, errs = await new_page(b, base, lang)
    await pg.goto(base + "/#auth"); await screen_ok(pg, f"{lang}_welcome")
    await sign_in_guest(pg, base)
    for r in ["discover", "map", "mine", "journal", "profile", "about", "new"]:
        await pg.evaluate(f"location.hash='#{r}'"); await screen_ok(pg, f"{lang}_{r}")
    check(not errs, f"{lang}: no JS errors {errs[:3] if errs else ''}")
    await pg.close()


async def safety_flow(b, base):
    print("\n[safety rules · create a women's table]")
    pg, errs = await new_page(b, base, "en")
    await sign_in_guest(pg, base)
    await pg.evaluate("location.hash='#new'"); await pg.wait_for_timeout(1200)
    await pg.locator("#c-more summary").first.click()
    await pg.click("[data-com=women]")
    check(await pg.locator("input[name=jm][value=instant]").is_disabled(), "women's table: 'instant join' is disabled")
    for _ in range(5):
        await pg.click("[data-cap='-1']")
    cap = int(await pg.locator("#cap-v").inner_text())
    check(cap >= 3, f"public table: seats can't go below 3 (got {cap})")
    await pg.click("[data-next]"); await pg.wait_for_timeout(1200)
    await pg.click("[data-next]"); await pg.wait_for_timeout(400)
    check(bool((await pg.locator("#c-err").inner_text()).strip()), "public table: can't publish without a real restaurant")
    # pick a restaurant (demo suggestions, or search)
    await pg.wait_for_timeout(2500)
    if await pg.locator("[data-use]").count():
        await pg.locator("[data-use]").first.click()
    else:
        await pg.locator(".ps input").last.fill("Pizza"); await pg.wait_for_timeout(2500)
        await pg.locator(".ps-list [role=option]").first.click()
    await pg.wait_for_timeout(500)
    await pg.evaluate("document.querySelector('#f-title').hidden=false")  # title field is folded by default
    evil = '<img src=x onerror="window.__xss=1">Dumplings'
    await pg.fill("#c-title", evil)
    await pg.click("[data-next]"); await pg.wait_for_timeout(700)   # publish
    check(await pg.locator(".safety-dialog").count() == 1, "first public table: table rules dialog appears")
    await pg.click(".safety-dialog [data-yes]"); await pg.wait_for_timeout(300)
    check(await pg.locator(".safety-dialog").count() == 1, "table rules: can't continue without ticking 'I agree'")
    await pg.check("#cd-ok"); await pg.click(".safety-dialog [data-yes]"); await pg.wait_for_timeout(2000)
    h = await pg.evaluate("location.hash")
    check(h.startswith("#t-"), f"table created (hash {h})")
    check(await pg.locator("[data-act=safety]").count() >= 1, "table page: 🛡️ safety button is there")
    check(await pg.evaluate("window.__xss === undefined"), "XSS: HTML in the title was NOT executed")
    check(await pg.locator(".sheet-body img[src=x]").count() == 0, "XSS: no injected <img> in the page")
    await pg.screenshot(path=os.path.join(SHOTS, "created_table.png"), full_page=True)
    # hand the table to someone else, then try to join it as me
    tid = h[3:]
    await pg.evaluate("""(tid)=>{const d=JSON.parse(localStorage.getItem('tb.demo.v2'));const t=d.tables.find(x=>x.id===tid);
      const other=d.tables.find(x=>x.host_id&&x.host_id!=='u_me')?.host_id||'u_lin';t.host_id=other;
      t.members=[{user_id:other,role:'host',status:'joined',joined_at:new Date().toISOString()}];
      localStorage.setItem('tb.demo.v2',JSON.stringify(d));}""", tid)
    await pg.reload(); await pg.wait_for_timeout(2000)
    check(await pg.locator("#w-ok").count() == 1, "women's table: joiner must confirm the community")
    await pg.click("[data-act=join]"); await pg.wait_for_timeout(500)
    check(await pg.locator("[data-act=join]").count() == 1, "women's table: join blocked until confirmed")
    await pg.check("#w-ok"); await pg.click("[data-act=join]"); await pg.wait_for_timeout(1500)
    check(await pg.locator("[data-act=join]").count() == 0, "women's table: after confirming, a join request is sent")
    check(not errs, f"safety flow: no JS errors {errs[:3] if errs else ''}")
    await pg.close()


async def main():
    srv, base = serve()
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            await screens(b, base, "zh")
            await screens(b, base, "en")
            await safety_flow(b, base)
            await b.close()
    finally:
        srv.shutdown()
    print(f"\n{len(fails)} failed" if fails else "\nall e2e checks passed")
    sys.exit(1 if fails else 0)


asyncio.run(main())
