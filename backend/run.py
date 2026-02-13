import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.socket_app:socket_app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
