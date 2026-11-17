FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY chat/requirements.txt ./chat/requirements.txt
RUN pip install --no-cache-dir -r chat/requirements.txt

COPY chat/app.py chat/sources.py ./chat/
COPY dist/index.html dist/resume.html ./dist/

USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "chat.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
