import os
import sys

# Crucial for ZeroGPU hardware on Hugging Face: satisfy the mandatory @spaces.GPU probe
try:
    import spaces
    @spaces.GPU(duration=10)
    def _zerogpu_probe():
        return "ZeroGPU probe satisfied"
except Exception:
    def _zerogpu_probe():
        return "CPU fallback"

# Crucial for Hugging Face Spaces with Gradio 5/6: disable Node SSR server to prevent port 7860 collision
os.environ["GRADIO_SSR_MODE"] = "false"

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from a2wsgi import WSGIMiddleware
from server import app as bottle_app

# Standalone ASGI application wrapping Bottle
asgi_app = WSGIMiddleware(bottle_app)

# Wrap for Hugging Face Gradio SDK
try:
    import gradio as gr
    from starlette.routing import Mount

    # Minimal UI placeholder for Gradio
    with gr.Blocks(title="Pamsimas Studio") as demo:
        gr.Markdown("### Pamsimas Studio is active.")
        _btn = gr.Button("probe", visible=False)
        _out = gr.Textbox(visible=False)
        _btn.click(_zerogpu_probe, outputs=_out)
except Exception as e:
    print(f"Gradio setup exception: {e}")
    demo = None

if __name__ == "__main__":
    port = int(os.environ.get("PORT") or os.environ.get("GRADIO_SERVER_PORT") or 7860)
    print(f"Pamsimas Studio starting on 0.0.0.0:{port} ...")
    if demo is not None:
        demo.launch(
            server_name="0.0.0.0",
            server_port=port,
            ssr_mode=False,
            show_error=True,
            prevent_thread_lock=True
        )
        # Attach our Bottle app at routes[0] AFTER launch so it intercepts all routes before Gradio
        demo.app.routes.insert(0, Mount("/", asgi_app, name="pamsimas_studio"))
        import time
        while True:
            time.sleep(3600)
    else:
        import uvicorn
        uvicorn.run(asgi_app, host="0.0.0.0", port=port)
