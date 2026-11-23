"""Exercise the installed dashboard with a temporary workspace in Chromium or WebKit."""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CONTENT = {"agents": "reviewer", "workflows": "Depends on", "tasks": "workspace.read",
           "memory": "Build conventions", "skills": "build-review", "plugins": "trace-index",
           "traces": "memory.updated", "sandbox": "sandbox.exec", "schedules": "Every 60 s",
           "workspaces": "reviewer"}
TABS = {"console": "runtime status", "workspaces": "reviewer", "schedules": "Every 60 s",
        "traces": "memory.updated"}


def seed(cli):
    step = {"kind": "workspace.read", "input": {"path": "notes.txt"}}
    cli("task:add", step)
    assert cli("task:run")["status"] == "completed"
    cli("task:add", {"kind": "workspace.read", "input": {"path": "missing.txt"}})
    assert cli("task:run")["status"] == "failed"
    task = cli("task:add", step)
    cli("task:cancel", {"id": task["id"]})
    cli("workflow:submit", {"name": "review", "steps": [step, {"kind": "sandbox.exec", "input": {}}]})
    cli("task:add", {"kind": "agent.run", "input": {"agent": "reviewer", "prompt": "test"}})
    cli("schedule:add", {**step, "everyMs": 60000})
    cli("workspace:create", {"id": "reviewer"})
    cli("memory:add", {"title": "Build conventions", "content": "private-note", "approved": True})
    cli("skill:propose", {"name": "build-review", "description": "Build checks", "instructions": "private-skill"})
    cli("skill:propose", {"name": "approve-check", "description": "Safe review", "instructions": "Validate build output"})
    cli("plugin:register", {"name": "trace-index", "version": "1.0.0", "description": "private-plugin", "approved": True})
    cli("plugin:enable", {"name": "trace-index", "approved": True})


def exercise(page, url, mobile):
    page.goto(url)
    expect(page.locator("#connection")).to_have_text("Connected")
    expect(page.locator("#chat")).to_be_visible()
    expect(page.locator("#chat-send")).to_be_disabled()
    assert page.locator(".brand img").evaluate("img => img.complete && img.naturalWidth > 0")
    if mobile:
        page.locator("#menu").click()
        expect(page.locator("#rail")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.locator("#rail")).to_be_hidden()

    def overview():
        if mobile:
            page.locator("#menu").click()
        page.locator("#navigation [data-view=workspace]").click()
        expect(page.locator("#hub")).to_be_visible()

    for area in ["navigation", "tiles"] + ([] if mobile else ["shortcuts"]):
        buttons = page.locator(f"#{area} button")
        keys = buttons.evaluate_all("buttons => buttons.map(b => b.dataset.view)")
        assert keys
        for key in keys:
            if area == "tiles":
                overview()
            if mobile and area == "navigation":
                page.locator("#menu").click()
            button = page.locator(f"#{area} [data-view={key}]")
            button.click()
            expect(button).to_have_attribute("aria-pressed", "true")
            if key == "workspace":
                expect(page.locator("#hub")).to_be_visible()
            elif key == "chat":
                expect(page.locator("#chat")).to_be_visible()
                expect(page.locator("#chat-send")).to_be_disabled()
            else:
                label = page.locator(f"#navigation [data-view={key}] b").text_content()
                expect(page.locator("#view-heading")).to_have_text(label)
                expect(page.locator("#activity")).to_contain_text(CONTENT[key])
            if key in {"workflows", "tasks", "sandbox"} and area == "navigation":
                select = page.locator("#filter")
                records = page.locator("#activity li")
                for value in select.locator("option").evaluate_all("options => options.map(o => o.value)"):
                    select.select_option(value)
                    if key == "tasks" and value in {"queued", "cancelled", "completed", "failed"}:
                        assert records.count() > 0, value
                    if value != "all":
                        for status in records.locator(".status").all_text_contents():
                            assert status.lower() == value or (value == "queued" and status == "Blocked")
                select.select_option("all")
    overview()
    for key, expected in TABS.items():
        button = page.locator("#tab-" + key)
        button.click()
        expect(button).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("tabpanel")).to_contain_text(expected)
    for key, selected in [("Home", "console"), ("ArrowLeft", "traces"), ("ArrowRight", "console"), ("End", "traces")]:
        page.keyboard.press(key)
        expect(page.locator("#tab-" + selected)).to_be_focused()
    page.locator("#tab-console").click()

    search = page.get_by_role("searchbox")
    search.fill("BUILD CONVENTIONS")
    search.press("Enter")
    expect(page.locator("#matches li")).to_have_count(1)
    expect(page.locator("#matches")).to_contain_text("Build conventions")
    search.fill("")
    page.get_by_role("button", name="Run search").click()
    for scope in CONTENT:
        page.locator("#scope").select_option(scope)
        expect(page.locator("#matches")).to_contain_text(CONTENT[scope])
    page.locator("#scope").select_option("all")
    search.fill("no-such-record")
    page.get_by_role("button", name="Run search").click()
    expect(page.locator("#matches")).to_have_text("No matching runtime records.")
    page.locator("#clear").click()
    expect(page.locator("#results")).to_be_hidden()
    expect(search).to_be_focused()
    page.locator("#refresh").click()
    expect(page.locator("#refresh")).to_be_enabled()
    expect(page.locator("#connection")).to_have_text("Connected")
    assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
    search.blur()


def run(root):
    home = root / "home"
    config = home / ".config/opencode"
    config.mkdir(parents=True)
    shutil.copy(ROOT / "opencode.json", config)
    env = {**os.environ, "HOME": str(home), "XDG_CONFIG_HOME": str(home / ".config"), "OMH_STATE_DIR": str(root / "state"),
           "OMH_WORKSPACE": str(root), "OMH_TRACE": "1", "OMH_DASHBOARD_PORT": "0",
           "OMH_DASHBOARD_ADMIN_TOKEN": "test-only-admin-token-00000000000000000000"}
    subprocess.run(["node", ROOT / "scripts/install-omh-runtime.mjs"], env=env, check=True, capture_output=True)
    scripts = config / "omh-runtime/scripts"

    def cli(action, data=None):
        return json.loads(subprocess.check_output(["node", scripts / "omh-runtime.mjs", action, json.dumps(data or {})], env=env))

    (root / "notes.txt").write_text("Smoke-test workspace.")
    server = subprocess.Popen(["node", scripts / "omh-dashboard.mjs"], env=env, stdout=subprocess.PIPE, text=True)
    try:
        url = server.stdout.readline().strip().split()[-1]
        with sync_playwright() as playwright:
            engine = os.environ.get("OMH_SMOKE_BROWSER", "chromium")
            if engine == "webkit":
                browser = playwright.webkit.launch()
            elif engine == "chromium":
                chrome = os.environ.get("CHROME_BIN") or shutil.which("chromium") or shutil.which("google-chrome")
                browser = playwright.chromium.launch(executable_path=chrome)
            else:
                raise ValueError(f"Unsupported dashboard smoke browser: {engine}")
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url)
            expect(page.locator("#connection")).to_have_text("Connected")
            expect(page.locator("#task-count")).to_have_text("0")
            expect(page.locator("#chat")).to_be_visible()
            page.locator("#navigation [data-view=workspace]").click()
            page.locator("#tiles [data-view=tasks]").click()
            expect(page.locator("#activity")).to_have_text("No records match this view.")
            seed(cli)
            for label, width, height in [("desktop", 1280, 720), ("mobile", 390, 844)]:
                page.set_viewport_size({"width": width, "height": height})
                exercise(page, url, label == "mobile")
                output = os.environ.get("OMH_SCREENSHOT_DIR")
                if output:
                    page.evaluate("document.fonts.ready")
                    page.screenshot(path=Path(output) / f"omh-dashboard-{label}.png", full_page=True)
            for width in [320, 720, 768, 930, 1024, 1440]:
                page.set_viewport_size({"width": width, "height": 800})
                assert page.evaluate("document.documentElement.scrollWidth === innerWidth"), width

            # Dashboard actions are wired to the real queue and retain confirmation gates.
            page.set_viewport_size({"width": 1280, "height": 720})
            page.locator("#navigation [data-view=tasks]").click()
            page.on("dialog", lambda dialog: dialog.accept("test-only-admin-token-00000000000000000000" if dialog.type == "prompt" else None))
            retry = page.locator("#activity button[data-action=retry]").first
            expect(retry).to_be_visible()
            retry_id = retry.get_attribute("data-task-id")
            retry.click()
            expect(page.locator("#activity button[data-action=cancel][data-task-id='" + retry_id + "']")).to_be_visible()
            cancel = page.locator("#activity button[data-action=cancel][data-task-id='" + retry_id + "']")
            cancel.click()
            assert cli("task:list") and next(t for t in cli("task:list") if t["id"] == retry_id)["status"] == "cancelled"
            page.locator("#navigation [data-view=schedules]").click()
            page.locator("#activity button[data-action=pause]").click()
            assert cli("schedule:list")[0]["enabled"] is False
            page.locator("#navigation [data-view=plugins]").click()
            page.locator("#activity button[data-action=disable]").click()
            assert cli("plugin:list")[0]["enabled"] is False
            page.locator("#navigation [data-view=skills]").click()
            page.locator("#activity button[data-action=reject]").first.click()
            assert any(p["status"] == "rejected" for p in cli("skill:proposals"))
            # An admin token is needed for restoring paused or disabled capabilities.
            page.locator("#navigation [data-view=schedules]").click()
            page.locator("#activity button[data-action=resume]").click()
            assert cli("schedule:list")[0]["enabled"] is True
            page.locator("#navigation [data-view=plugins]").click()
            page.locator("#activity button[data-action=enable]").click()
            assert cli("plugin:list")[0]["enabled"] is True
            page.locator("#navigation [data-view=skills]").click()
            page.locator("#activity button[data-action=accept]").click()
            assert any(p["status"] == "accepted" for p in cli("skill:proposals"))
            page.locator("#navigation [data-view=workspace]").click()
            page.locator("#refresh").click()
            expect(page.locator("#connection")).to_have_text("Connected")

            # A damaged store must produce an offline state, preserve the last snapshot,
            # then recover after the operator repairs the file and refreshes.
            path = root / "state/tasks.json"
            previous = path.read_bytes()
            path.write_text("{")
            page.locator("#refresh").click()
            expect(page.locator("#connection")).to_have_text("Offline")
            expect(page.get_by_role("alert")).to_contain_text("last snapshot")
            page.reload()
            expect(page.get_by_role("alert")).to_contain_text("Runtime state unavailable")
            path.write_bytes(previous)
            page.locator("#refresh").click()
            expect(page.get_by_role("alert")).to_be_hidden()
            expect(page.locator("#task-count")).to_have_text("6")
            assert not errors, errors
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="omh-dashboard-") as tmp:
        run(Path(tmp))
    print("Installed dashboard passed navigation, feature, filter, keyboard, responsive layout and recovery checks.")
