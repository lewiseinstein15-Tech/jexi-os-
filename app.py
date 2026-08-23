from flask import Flask, request, render_template_string, session
import subprocess
import os

app = Flask(__name__)
app.secret_key = 'jexi-secret-key-change-this'
REPO = "/workspaces/jexi-os-"
MODEL = "groq/llama3-8b-8192"

HTML = """
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Jexi AI Agent</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d0d0d; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }
        .header { background: #1a1a1a; padding: 20px; text-align: center; border-bottom: 1px solid #333; }
        .header h1 { color: #00ff88; font-size: 24px; font-weight: 600; }
        .chat-container { flex: 1; overflow-y: auto; padding: 20px; max-width: 900px; margin: 0 auto; width: 100%; }
        .message { margin-bottom: 20px; display: flex; align-items: flex-start; }
        .message.user { justify-content: flex-end; }
        .message.assistant { justify-content: flex-start; }
        .message-content { max-width: 80%; padding: 15px 20px; border-radius: 18px; line-height: 1.5; font-size: 15px; white-space: pre-wrap; word-wrap: break-word; }
        .user .message-content { background: #00ff88; color: #000; border-bottom-right-radius: 4px; }
        .assistant .message-content { background: #1a1a1a; color: #e0e0e0; border-bottom-left-radius: 4px; border: 1px solid #333; }
        .input-container { background: #1a1a1a; padding: 20px; border-top: 1px solid #333; }
        .input-wrapper { max-width: 900px; margin: 0 auto; display: flex; gap: 10px; }
        textarea { flex: 1; background: #0d0d0d; color: #e0e0e0; border: 1px solid #333; border-radius: 12px; padding: 15px; font-size: 15px; resize: none; min-height: 60px; max-height: 150px; font-family: inherit; }
        textarea:focus { outline: none; border-color: #00ff88; }
        button { background: #00ff88; color: #000; border: none; border-radius: 12px; padding: 0 30px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        button:hover { background: #00cc6a; }
        button:disabled { background: #333; color: #666; cursor: not-allowed; }
        .loading { display: none; text-align: center; padding: 10px; color: #00ff88; font-style: italic; }
        .loading.show { display: block; }
        .error { color: #ff4444; background: #330000; padding: 10px; border-radius: 8px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="header"><h1>🤖 Jexi AI Agent</h1></div>
    <div class="chat-container" id="chatContainer">
        {% if error %}
            <div class="error">{{ error }}</div>
        {% endif %}
        {% if messages %}
            {% for msg in messages %}
                <div class="message {{ msg.role }}">
                    <div class="message-content">{{ msg.content }}</div>
                </div>
            {% endfor %}
        {% else %}
            <div class="message assistant">
                <div class="message-content">👋 Hello! I'm Jexi, your AI coding assistant. What would you like me to build for you today?</div>
            </div>
        {% endif %}
    </div>
    <div class="loading" id="loading"> Jexi is coding...</div>
    <div class="input-container">
        <form method="POST" id="chatForm" class="input-wrapper">
            <textarea name="prompt" id="promptInput" placeholder="Tell me what to build..." required>{{ current_prompt }}</textarea>
            <button type="submit" id="sendBtn">Send</button>
        </form>
    </div>
    <script>
        document.getElementById('chatForm').addEventListener('submit', function() {
            document.getElementById('loading').classList.add('show');
            document.getElementById('sendBtn').disabled = true;
            document.getElementById('sendBtn').textContent = 'Working...';
        });
        const chat = document.getElementById('chatContainer');
        chat.scrollTop = chat.scrollHeight;
    </script>
</body>
</html>
"""

@app.route('/', methods=['GET', 'POST'])
def index():
    if 'messages' not in session:
        session['messages'] = []
    
    error = None
    
    if request.method == 'POST':
        prompt = request.form.get('prompt', '').strip()
        if prompt:
            session['messages'].append({'role': 'user', 'content': prompt})
            
            # Run Aider
            try:
                # We pass the API key directly to aider just in case
                env = os.environ.copy()
                cmd = ["aider", "--model", MODEL, "--yes-always", "--message", prompt]
                result = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=120, env=env)
                response = result.stdout.strip()
                if result.stderr:
                    response += "\n\n" + result.stderr.strip()
                if not response:
                    response = "✅ Task completed successfully!"
            except subprocess.TimeoutExpired:
                response = "⏳ The task is taking too long. Jexi is still working in the background - check the terminal for progress!"
            except Exception as e:
                response = f"⚠️ Error: {str(e)}"
                error = str(e)
            
            session['messages'].append({'role': 'assistant', 'content': response})
            session.modified = True
            
            # Auto-commit to GitHub
            try:
                subprocess.run(["git", "add", "."], cwd=REPO, capture_output=True, timeout=10)
                subprocess.run(["git", "commit", "-m", f"Jexi: {prompt[:30]}..."], cwd=REPO, capture_output=True, timeout=10)
                subprocess.run(["git", "push"], cwd=REPO, capture_output=True, timeout=10)
            except:
                pass 
        
        return render_template_string(HTML, messages=session['messages'], current_prompt='', error=error)
    
    return render_template_string(HTML, messages=session['messages'], current_prompt='', error=None)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
