"""
Optional local helper (not the JEXI brain).

The Node/Express server in `server/` is the real product. This Flask wrapper
was a leftover Aider playground that:
  - used a hardcoded secret key
  - pointed at a Codespaces path that does not exist here
  - auto-committed and pushed every prompt to GitHub

Those behaviours are disabled. Run the real stack instead:

    cd server && npm start
    npm run dev
"""

from flask import Flask, render_template_string
import os

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY') or os.urandom(32)

HTML = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>JEXI — use the Node app</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
               background: #0d0d0d; color: #e0e0e0; min-height: 100vh;
               display: flex; align-items: center; justify-content: center; margin: 0; }
        .box { max-width: 560px; padding: 32px; border: 1px solid #333; border-radius: 16px; }
        h1 { color: #e0e0e0; font-size: 22px; }
        code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; }
        a { color: #ccc; }
    </style>
</head>
<body>
    <div class="box">
        <h1>This is not the JEXI app</h1>
        <p>The real JEXI OS brain is the Express server in <code>server/</code>.</p>
        <p>Start it with:</p>
        <p><code>cd server && npm start</code></p>
        <p>Then the UI: <code>npm run dev</code> and open <code>http://localhost:3000</code>.</p>
    </div>
</body>
</html>
"""


@app.route('/', methods=['GET', 'POST'])
def index():
    return render_template_string(HTML)


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', 5000)), debug=False)
