import sys

from loguru import logger


def setup_logging(environment: str = "development") -> None:
    logger.remove()
    level = "INFO" if environment == "production" else "DEBUG"
    if environment == "production":
        logger.add(
            sys.stdout,
            level=level,
            serialize=True,
        )
        return

    logger.add(
        sys.stdout,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>",
        level=level,
    )
    if environment != "production":
        try:
            from pathlib import Path
            Path("logs").mkdir(exist_ok=True)
            logger.add("logs/app.log", rotation="500 MB", retention="10 days", compression="zip", level="DEBUG")
        except Exception as e:
            logger.warning(f"No se pudo crear archivo de logs: {e}")
