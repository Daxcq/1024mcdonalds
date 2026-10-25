from .engine import BurgerEngine
from .recipes import load_recipes

_engine: BurgerEngine | None = None


def get_engine() -> BurgerEngine:
    """配方表只在首次使用时加载一次(约 10 秒内的 JSON 解析, 不联网)。"""
    global _engine
    if _engine is None:
        _engine = BurgerEngine(load_recipes())
    return _engine
