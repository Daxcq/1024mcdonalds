"""点单会话: 持有门店、菜单、购物车和对话历史。"""
from dataclasses import dataclass, field

from .cart import Cart
from .menu import Meal


@dataclass
class Store:
    store_code: str
    name: str
    be_type: int = 1  # 1 到店自取; 5 得来速; 2 麦乐送
    be_code: str | None = None

    @property
    def order_type(self) -> int:
        return 2 if self.be_type in (2, 6) else 1

    def scope(self) -> dict:
        """query-meals / calculate-price / create-order 共用的门店参数。"""
        p = {"storeCode": self.store_code, "orderType": self.order_type, "beType": self.be_type}
        if self.be_code and self.be_type != 1:
            p["beCode"] = self.be_code
        return p


@dataclass
class Session:
    id: str
    store: Store | None = None
    menu: dict[str, Meal] = field(default_factory=dict)
    nutrition: dict[str, dict] = field(default_factory=dict)
    cart: Cart = field(default_factory=Cart)
    history: list[dict] = field(default_factory=list)
    pending_order: dict | None = None  # calculate_price 之后生成, 等用户点确认

    def snapshot(self) -> dict:
        return {
            "store": self.store.__dict__ if self.store else None,
            "cart": self.cart.to_dict(),
            "pending": self.pending_order,
        }
