"""Command-line interface and OpenAI-compatible provider for the harness."""

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class ProviderError(Exception):
    """A request failed or the provider returned an unexpected response."""


class RejectRedirects(HTTPRedirectHandler):
    """Keep credentials scoped to the configured provider URL."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ChatSession:
    def __init__(self, base_url, model, api_key):
        self.endpoint = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.api_key = api_key
        self.history = []
        self.opener = build_opener(RejectRedirects())

    def send(self, prompt):
        messages = [*self.history, {"role": "user", "content": prompt}]
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request = Request(
            self.endpoint,
            data=json.dumps({"model": self.model, "messages": messages}).encode(),
            headers=headers,
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=60) as response:
                payload = json.load(response)
            reply = payload["choices"][0]["message"]["content"]
        except HTTPError as error:
            error.close()
            raise ProviderError(f"Provider returned HTTP {error.code}.") from None
        except (URLError, OSError):
            raise ProviderError("Could not reach the provider or read its response.") from None
        except (ValueError, KeyError, IndexError, TypeError):
            raise ProviderError("Provider returned an invalid chat response.") from None

        if not isinstance(reply, str) or not reply.strip():
            raise ProviderError("Provider returned an empty assistant response.")

        self.history = [*messages, {"role": "assistant", "content": reply}]
        return reply



def terminal_chat(session, model, interactive):
    term = os.getenv("TERM", "dumb")
    color = interactive and term != "dumb" and not os.getenv("NO_COLOR")
    palette = {
        "cyan": ("0;229;255", 96),
        "magenta": ("255;59;212", 95),
        "mint": ("158;255;200", 92),
        "violet": ("124;108;255", 94),
    }
    truecolor = os.getenv("COLORTERM", "").lower() in {"truecolor", "24bit"}

    def paint(text, accent):
        if not color:
            return text
        rgb, basic = palette[accent]
        code = f"38;2;{rgb}" if truecolor else str(basic)
        return f"\x1b[{code}m{text}\x1b[0m"

    if interactive:
        print(paint("OPENMIND // HARNESS", "cyan"))
        print(f"{paint('Model', 'violet')}  {model}")
        print(f"{paint('/exit', 'violet')}  End session")
        print()
    while True:
        try:
            prompt = input(paint("You", "magenta") + "  › " if interactive else "")
        except EOFError:
            return 0
        except KeyboardInterrupt:
            if interactive:
                print()
            return 130
        if prompt.strip() == "/exit":
            return 0
        if not prompt.strip():
            continue
        try:
            reply = session.send(prompt)
        except ProviderError as error:
            print(error, file=sys.stderr)
            if not interactive:
                return 1
            continue
        if interactive:
            print(paint("OpenMind", "mint"))
        print(reply)
        if interactive:
            print()


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="openmind-harness", description="Run a chat session with the OpenMind engine."
    )
    parser.add_argument("prompt", nargs="?", help="Send one prompt and exit.")
    parser.add_argument("--model", default=os.getenv("OPENMIND_MODEL"), help="Provider model ID.")
    parser.add_argument(
        "--base-url",
        default=os.getenv("OPENMIND_CUSTOM_BASE_URL", "https://api.openai.com/v1"),
        help="OpenAI-compatible API base URL, including its version prefix.",
    )
    parser.add_argument("--web", action="store_true", help="Open a local web workspace.")
    parser.add_argument("--port", type=int, default=3080, help="Loopback workspace port.")
    args = parser.parse_args(argv)
    if args.web and (args.prompt is not None or not 0 <= args.port <= 65535):
        parser.error("Web mode requires a valid port and takes prompts in the browser.")
    if not args.model or not args.model.strip():
        parser.error("Choose a model with --model or OPENMIND_MODEL.")
    try:
        endpoint = urlsplit(args.base_url)
        if (
            endpoint.scheme not in {"https", "http"}
            or not endpoint.hostname
            or endpoint.username is not None
            or endpoint.query
            or endpoint.fragment
        ):
            raise ValueError
    except ValueError:
        parser.error("Use an HTTP or HTTPS base URL without credentials, a query, or a fragment.")

    key_variable = (
        "OPENAI_API_KEY" if endpoint.hostname == "api.openai.com"
        else "OPENMIND_CUSTOM_API_KEY"
    )
    api_key = os.getenv(key_variable)
    if args.base_url == os.getenv("OPENMIND_CUSTOM_BASE_URL"):
        api_key = os.getenv("OPENMIND_CUSTOM_API_KEY") or api_key
    if api_key and endpoint.scheme != "https" and endpoint.hostname not in {
        "localhost", "127.0.0.1", "::1",
    }:
        parser.error("Bearer credentials require HTTPS for remote providers.")
    if api_key and any(char in api_key for char in "\r\n"):
        parser.error("A bearer key must fit on one line.")

    session = ChatSession(args.base_url, args.model, api_key)
    if args.web:
        from .web import serve
        try:
            return serve(session, args.port)
        except OSError as error:
            parser.exit(1, f"Workspace could not start: {error}\n")
    if args.prompt is not None:
        if not args.prompt.strip():
            parser.error("Enter a non-empty prompt.")
        try:
            print(session.send(args.prompt))
        except ProviderError as error:
            print(error, file=sys.stderr)
            return 1
        return 0

    interactive = sys.stdin.isatty() and sys.stdout.isatty()
    return terminal_chat(session, args.model, interactive)
