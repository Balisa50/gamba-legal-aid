# Gambia Legal Aid

RAG chatbot for Gambian law. Ask a legal question in plain English, get an answer grounded in actual statutes with citations.

Built because Gambians generally have no easy access to legal information. Lawyers are expensive and scarce, and the laws are scattered across PDFs most people can never find.

## How it works

1. Gambian statutes are chunked, embedded, and stored in a vector index
2. A query comes in, the retrieval layer pulls the most relevant passages
3. The hallucination guard checks that the generated answer is actually anchored to what was retrieved — if it is not, the answer is rejected
4. If nothing in the retrieved context supports a response, the model says so rather than making something up

## Stack

- Python + FastAPI — backend and retrieval pipeline
- Vector search — semantic document retrieval
- Next.js — frontend
- Vercel — hosting

## Setup

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend
cd frontend
npm install && npm run dev
```

## Live

[gamba-legal-aid.vercel.app](https://gamba-legal-aid.vercel.app)
