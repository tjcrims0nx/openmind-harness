"""Browser verification for the candidate OpenUI frontend.

Uses only mocked same-origin provider/runtime requests; no API keys or
model spending. Captures genuine Chromium renderings at mobile and desktop.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE=os.getenv("OMH_OPENUI_BASE","http://127.0.0.1:5181")
OUT=Path(os.getenv("OMH_OPENUI_SCREENSHOT_DIR","/tmp/omh-openui-screenshots"))
OUT.mkdir(parents=True,exist_ok=True)

def run(page,width):
    errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    async_state={
      "counts":{"queued":2,"running":1,"completed":7,"failed":0,"cancelled":0},
      "agents":[{"name":"reviewer","queued":1,"running":0}],
      "tasks":[{"id":"task-001","kind":"workspace.read","status":"completed","attempts":1}],
      "workspaces":["default","project-demo"],
      "memory":[{"id":"note-01","title":"Project notes","scope":"workspace"}],
      "workflowSteps":[{"id":"step-01","kind":"workspace.read","status":"completed"}],
      "plugins":[{"name":"omh-chat","version":"1.0.0","enabled":True}],
      "traces":[{"type":"task.completed","at":"2026-11-23T16:00:00Z"}],
      "evidenceMcp":{"name":"OpenMind Jailbreak Lab","enabled":True,"connected":True,"state":"connected","restarts":0,"lastError":None,"lastPingAt":"2026-11-23T21:00:00Z","tools":["omjb_status","omjb_list_runs","omjb_run_summary","omjb_pending_reviews","omjb_compare_runs"],"dbPath":"/tmp/evidence.db","pid":1234}
    }
    def handle_chat(route):
        request=route.request
        if request.method=="GET":
            route.fulfill(status=200,content_type="application/json",body='{"providers":[{"id":"openai","label":"OpenAI","model":"test-model","available":true},{"id":"anthropic","label":"Anthropic","model":"test-other","available":false}]}')
        else:
            route.fulfill(status=200,content_type="application/json",body='{"provider":"openai","model":"test-model","text":"**Hello** from OMH!"}')
    page.route("**/api/chat",handle_chat)
    page.route("**/api/state",lambda route:route.fulfill(status=200,json=async_state))
    page.route("**/api/session",lambda route:route.fulfill(status=200,json={"csrf":"mock-session-token"}))
    page.goto(BASE,wait_until="networkidle")
    expect(page.get_by_role("heading",name="Chat",exact=True)).to_be_visible()
    expect(page.get_by_role("heading",name="What can I help you build?")).to_be_visible()
    expect(page.locator("#chat-provider")).to_have_value("")
    page.locator("#chat-provider").select_option("openai")
    expect(page.get_by_role("button",name="Send ↑")).to_be_disabled()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth+1"),"Horizontal overflow on "+str(width)
    assert page.locator(".composer").evaluate("el=>el.getBoundingClientRect().bottom<=innerHeight+2"),"Composer below fold"
    page.screenshot(path=str(OUT/("omh-openui-mobile.png" if width<600 else "omh-openui-desktop.png")),full_page=True)

    page.locator("#message").fill("Say hello")
    page.get_by_role("button",name="Send ↑").click()
    expect(page.locator(".message.assistant")).to_contain_text("Hello from OMH!")
    assert "mock-session-token" not in page.locator("body").inner_text()
    page.get_by_role("button",name="+ New").click()
    expect(page.get_by_role("heading",name="What can I help you build?")).to_be_visible()

    if width<600:
        page.get_by_role("button",name="Toggle navigation").click()
    page.get_by_role("button",name="Tasks",exact=True).click()
    expect(page.get_by_role("heading",name="Tasks",exact=True)).to_be_visible()
    expect(page.get_by_text("workspace.read")).to_be_visible()
    if width<600:
        page.get_by_role("button",name="Toggle navigation").click()
    page.get_by_role("button",name="Plugins",exact=True).click()
    expect(page.locator(".runtime-record").get_by_text("omh-chat", exact=True)).to_be_visible()
    expect(page.locator(".evidence-card .runtime-list-title strong")).to_have_text("OpenMind Jailbreak Lab")
    expect(page.locator(".evidence-card .runtime-status.connected")).to_have_text("connected")
    expect(page.get_by_text("5 read-only tools")).to_be_visible()
    page.route("**/api/plugins/omjb/retry",lambda route:route.fulfill(status=200,json=async_state["evidenceMcp"]))
    page.get_by_role("button",name="Retry connection").click()
    expect(page.locator(".evidence-card .runtime-status.connected")).to_have_text("connected")
    assert not errors,"Browser exceptions: "+str(errors)

with sync_playwright() as pw:
    browser=pw.chromium.launch()
    for width,height in [(390,844),(1440,900)]:
        context=browser.new_context(viewport={"width":width,"height":height},device_scale_factor=1)
        run(context.new_page(),width)
        context.close()
    browser.close()
print("OpenUI responsive smoke: mobile + desktop passed")
