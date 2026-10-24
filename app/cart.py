"""会话级购物车。agent 只能改购物车, 不能下单。"""
from dataclasses import dataclass, field


@dataclass
class CartLine:
    code: str
    name: str
    price: float
    quantity: int = 1


@dataclass
class Cart:
    lines: dict[str, CartLine] = field(default_factory=dict)

    def add(self, code: str, name: str, price: float, quantity: int = 1) -> None:
        if quantity < 1:
            return
        if code in self.lines:
            self.lines[code].quantity += quantity
        else:
            self.lines[code] = CartLine(code, name, price, quantity)

    def set_quantity(self, code: str, quantity: int) -> None:
        if code not in self.lines:
            return
        if quantity <= 0:
            del self.lines[code]
        else:
            self.lines[code].quantity = quantity

    def clear(self) -> None:
        self.lines.clear()

    def total(self) -> float:
        return round(sum(l.price * l.quantity for l in self.lines.values()), 2)

    def items_for_mcp(self) -> list[dict]:
        return [{"productCode": l.code, "quantity": l.quantity} for l in self.lines.values()]

    def to_dict(self) -> dict:
        return {
            "lines": [
                {"code": l.code, "name": l.name, "price": l.price, "quantity": l.quantity}
                for l in self.lines.values()
            ],
            "total": self.total(),
        }
