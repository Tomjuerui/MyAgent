"""
Mock ERP 种子数据（电子元器件采购场景）
15 家供应商 / 36 种元器件 / 全量库存（约 20% 低于安全库存）/ 约 62 笔半年期采购订单。

数据为一次性编造的合成数据（非爬取），random.seed 固定保证可复现；
其中部分元器件低于安全库存、部分供应商已停止合作、部分订单停留在待审核，
专门为了让 inventory_warning / supplier_page(status=0) / HITL 审批流有真实演示对象。
"""
import random
from datetime import datetime, timedelta

from .db import db_tx, get_conn, init_db

random.seed(42)

# ============ 供应商（supplier_code, name, contact_person, phone, email, address, credit_rating, status） ============
SUPPLIERS = [
    ("SUP001", "深圳立创微电子", "陈立", "0755-83410201", "sales@lcsc-micro.com", "深圳市福田区华强北街道振华路", "A", 1),
    ("SUP002", "广州风华电子", "刘芳", "020-38204156", "fenghua@gzfh-mlcc.cn", "广州市黄埔区科学城开源大道", "A", 1),
    ("SUP003", "上海贝岭电子", "张伟民", "021-58350102", "belling@shbl-ic.com", "上海市浦东新区张江高科技园区", "A", 1),
    ("SUP004", "深圳华秋电子", "周建", "0755-27480185", "hq@szhq-pcb.com", "深圳市宝安区西乡街道固戍社区", "B", 1),
    ("SUP005", "杭州士兰微电子", "王强", "0571-86802136", "silan@hzsl-power.cn", "杭州市滨江区江南大道", "A", 1),
    ("SUP006", "华强北芯诚电子", "李梅", "13510293847", "xincheng@szic-market.com", "深圳市福田区华强电子世界", "B", 1),
    ("SUP007", "南京微盟电子", "赵国庆", "025-84430127", "weimeng@njwm-analog.com", "南京市江宁区双龙大道", "B", 1),
    ("SUP008", "苏州竞陆连接器", "孙丽华", "0512-67520318", "jinglu@szjl-connector.cn", "苏州市工业园区金鸡湖大道", "B", 1),
    ("SUP009", "深圳顺络电子", "郑海涛", "0755-26730154", "sunlord@szsl-inductor.cn", "深圳市南山区高新科技园", "C", 1),
    ("SUP010", "深圳晶科鑫晶振", "吴小敏", "13715263849", "jikexin@szjx-xtal.com", "深圳市龙华新区观澜大道", "B", 1),
    ("SUP011", "厦门宏发电声", "林国栋", "0592-7192011", "hongfa@xmhf-relay.cn", "厦门市集美区东林路", "A", 1),
    ("SUP012", "东莞硅威半导体", "黄志远", "0769-22401983", "guiwei@dgsw-sensor.com", "东莞市南城区科技大道", "C", 1),
    ("SUP013", "深圳德普微电子", "徐静", "15012839475", "depull@szdp-power.com", "深圳市龙岗区坂田街道", "C", 1),
    ("SUP014", "天津中环电子", "马建军", "022-27301564", "zhonghuan@tjzh-elec.cn", "天津市西青区赛达工业园", "C", 0),
    ("SUP015", "常州银河电子", "钱伟", "0519-88102467", "yinhe@czyh-elec.com", "常州市新北区太湖路", "D", 0),
]

# ============ 元器件（part_code, name, model, specification, unit, purchase_price, suggested_retail_price,
#                stock_warning_value, supplier_code, category, description） ============
PARTS = [
    # --- 主控芯片 ---
    ("IC-0001", "STM32主控芯片", "STM32F103C8T6", "LQFP48 / 72MHz / 64KB Flash", "个", 8.5, 12.0, 200, "SUP001", "主控芯片", "入门级32位MCU，公司主力开发板通用料"),
    ("IC-0002", "ESP32 WiFi模组", "ESP32-WROOM-32E", "4MB Flash / PCB天线", "个", 12.8, 18.0, 150, "SUP001", "主控芯片", "WiFi+蓝牙双模模组，物联网网关项目用料"),
    ("IC-0003", "GD32主控芯片", "GD32F303CCT6", "LQFP48 / 120MHz", "个", 7.2, 10.5, 200, "SUP005", "主控芯片", "国产替代MCU，成本敏感型项目首选"),
    ("IC-0004", "USB转串口芯片", "CH340G", "SOP-16", "个", 1.8, 3.0, 500, "SUP006", "主控芯片", "调试口通用转换芯片，消耗量极大"),
    ("IC-0005", "AVR单片机", "ATMEGA328P-AU", "TQFP32 / 20MHz", "个", 9.6, 14.0, 200, "SUP007", "主控芯片", "经典8位MCU，教育套件产线用料"),
    ("IC-0006", "RP2040双核MCU", "RP2040", "QFN-56 / 双核133MHz", "个", 13.0, 19.0, 120, "SUP001", "主控芯片", "树莓派微控制器，新品开发中"),
    # --- 存储芯片 ---
    ("IC-0101", "SPI Flash存储芯片", "W25Q128JVSIQ", "SOP-8 / 128Mbit", "个", 3.2, 5.0, 400, "SUP001", "存储芯片", "16MB SPI Flash，固件存储通用料"),
    ("IC-0102", "EEPROM存储芯片", "AT24C256", "DIP-8 / 256Kbit", "个", 1.5, 2.5, 600, "SUP006", "存储芯片", "参数存储，工控板通用"),
    ("IC-0103", "异步SRAM", "IS62WV51216BLL", "TSOP-44 / 8Mbit / 55ns", "个", 15.0, 22.0, 80, "SUP007", "存储芯片", "并口SRAM，显示缓冲用途"),
    # --- 被动元件 ---
    ("RC-0201", "贴片电阻10KΩ", "0805-10K", "0805 / ±1% / 1/8W", "盘", 8.0, 12.0, 30, "SUP002", "被动元件", "5千只/盘，通用阻值常备料"),
    ("RC-0202", "贴片电容100nF", "0805-104", "0805 / 50V / X7R", "盘", 15.0, 22.0, 20, "SUP002", "被动元件", "5千只/盘，去耦电容标配"),
    ("RC-0203", "铝电解电容470uF", "470uF-25V", "10x17mm / 105°C", "个", 0.35, 0.6, 5000, "SUP002", "被动元件", "电源滤波主力容量"),
    ("RC-0204", "功率电感10uH", "CD54-100", "CD54 / ±20% / 4.7A", "个", 0.28, 0.5, 5000, "SUP009", "被动元件", "DC-DC配合电感"),
    ("RC-0205", "贴片磁珠600Ω", "0603-600R", "0603 / 600Ω@100MHz", "千只", 6.5, 10.0, 25, "SUP009", "被动元件", "EMC整改常备料"),
    ("RC-0206", "精密电位器", "WH5-1K", "WH5 / 1KΩ / 线性", "个", 1.2, 2.0, 800, "SUP008", "被动元件", "面板调节旋钮配套"),
    # --- 电源器件 ---
    ("PW-0301", "LDO稳压芯片3.3V", "AMS1117-3.3", "SOT-223 / 1A", "个", 0.55, 1.0, 3000, "SUP003", "电源器件", "3.3V供电轨通用LDO"),
    ("PW-0302", "DC-DC降压芯片5V", "LM2596S-5.0", "TO-263-5 / 3A", "个", 2.8, 4.5, 1500, "SUP003", "电源器件", "5V大电流降压方案"),
    ("PW-0303", "DC-DC降压芯片", "MP1584EN", "SOIC-8 / 3A / 28V输入", "个", 1.9, 3.2, 2000, "SUP013", "电源器件", "宽压输入小体积方案"),
    ("PW-0304", "肖特基二极管", "SS34", "SMA / 3A / 40V", "千只", 18.0, 26.0, 15, "SUP005", "电源器件", "整流续流通用"),
    ("PW-0305", "N沟道MOSFET", "IRF540N", "TO-220 / 100V / 33A", "个", 2.2, 3.5, 1200, "SUP005", "电源器件", "功率开关与电机驱动"),
    ("PW-0306", "AC-DC电源模块", "HLK-PM01", "5V / 2A / 隔离", "个", 8.8, 13.0, 300, "SUP013", "电源器件", "220V转5V成品模块"),
    # --- 连接器 ---
    ("CN-0401", "XH2.54端子线", "XH2.54-4P", "4P / 带线20cm", "条", 0.8, 1.3, 4000, "SUP008", "连接器", "板间连接标配线束"),
    ("CN-0402", "USB Type-C母座", "TYPE-C-16P", "16P / 沉板式 / 5A", "个", 0.9, 1.5, 3000, "SUP008", "连接器", "新款产品统一Type-C供电"),
    ("CN-0403", "排针排母2.54mm", "2.54-40P", "40P / 直插 / 镀金", "套", 1.6, 2.6, 2000, "SUP008", "连接器", "排针+排母配套"),
    ("CN-0404", "JST-GH微型连接器", "JST-GH-4P", "1.25mm / 4P", "个", 0.65, 1.1, 5000, "SUP008", "连接器", "飞控/小型化设备专用"),
    ("CN-0405", "接线端子5.08mm", "TB-2P-5.08", "2P / 5.08mm / 竖式", "个", 0.5, 0.9, 4000, "SUP004", "连接器", "工控电源接线端子"),
    # --- 传感器 ---
    ("SN-0501", "温湿度传感器", "SHT30-DIS-B", "I2C / ±2%RH / ±0.2°C", "个", 9.5, 14.0, 200, "SUP012", "传感器", "高精度数字温湿度"),
    ("SN-0502", "数字温度传感器", "DS18B20", "TO-92 / -55~125°C / 1-Wire", "个", 3.2, 5.0, 500, "SUP012", "传感器", "单总线测温，冷库监测项目用料"),
    ("SN-0503", "六轴姿态传感器", "MPU6050", "QFN-24 / 三轴加速度+陀螺仪", "个", 7.8, 12.0, 200, "SUP012", "传感器", "平衡车与云台项目"),
    ("SN-0504", "光照传感器", "BH1750FVI", "SOP-8 / I2C / 1-65535lx", "个", 3.8, 6.0, 300, "SUP012", "传感器", "智能照明项目"),
    ("SN-0505", "烟雾传感器", "MQ-2", "DIP-6 / 烟雾/可燃气体", "个", 6.5, 10.0, 250, "SUP012", "传感器", "安防报警产品线"),
    ("SN-0506", "人体红外传感器", "HC-SR501", "检测距离7m / 角度110°", "个", 4.2, 6.5, 300, "SUP006", "传感器", "感应灯具配套"),
    # --- 晶振 ---
    ("XT-0601", "无源晶振8MHz", "HC-49S-8M", "HC-49S / 8MHz / ±20ppm", "个", 0.4, 0.7, 5000, "SUP010", "晶振", "MCU主时钟通用"),
    ("XT-0602", "贴片晶振32.768KHz", "3215-32.768K", "3215 / 32.768KHz / ±20ppm", "个", 0.6, 1.0, 3000, "SUP010", "晶振", "RTC时钟源"),
    # --- 继电器 ---
    ("RL-0701", "信号继电器", "HK4100F-DC5V", "5V / 3A / 一组转换", "个", 1.8, 3.0, 1500, "SUP011", "继电器", "小功率负载切换"),
    ("RL-0702", "固态继电器", "SSR-25DA", "25A / 380V / 输入3-32V", "个", 12.5, 18.0, 100, "SUP011", "继电器", "温控柜加热控制"),
]

# ============ 库存 ============
# 未列出的元器件：current_quantity = safety_stock * random.uniform(1.2, 3.0)（库存充足）
# 列出的元器件：current_quantity 指定，均低于 safety_stock（= parts.stock_warning_value），用于触发 inventory_warning
INVENTORY_LOW_STOCK = {
    # part_code: (current_quantity, warehouse_location)
    "IC-0004": (380, "B-02-01"),    # CH340G，预警值500
    "IC-0101": (260, "A-03-02"),    # W25Q128，预警值400
    "RC-0202": (12, "C-01-02"),     # 0805电容（盘），预警值20
    "PW-0301": (2100, "B-01-03"),   # AMS1117，预警值3000
    "CN-0402": (1800, "C-02-04"),   # Type-C母座，预警值3000
    "SN-0502": (320, "D-01-02"),    # DS18B20，预警值500
    "XT-0602": (2400, "E-01-01"),   # 32.768K晶振，预警值3000
}

# ============ 采购订单 ============
# 状态分布：历史订单以已完成/已收货为主，近几日保留待审核订单供 HITL 审批流演示
ORDER_REMARKS = [
    "", "常规月度采购", "急单，要求48小时内到货", "新项目备料",
    "框架协议价", "替换料，需供应商提供规格书", "产线补货", "季度集中采购",
]

# 每种单位的下单数量范围：(小计量单位用大量，盘/千只用小量)
UNIT_QTY_RANGE = {"盘": (1, 8), "千只": (1, 6)}


def _random_quantity(unit: str) -> int:
    low, high = UNIT_QTY_RANGE.get(unit, (20, 500))
    return random.randint(low, high)


def seed_db():
    """灌入全部种子数据（幂等前置：调用方保证表已建且为空）"""
    init_db()

    with db_tx() as conn:
        # ---- 供应商 ----
        for row in SUPPLIERS:
            conn.execute(
                "INSERT INTO suppliers (supplier_code, name, contact_person, phone, email, address, credit_rating, status) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", row
            )
        supplier_id = {r["supplier_code"]: r["id"]
                       for r in conn.execute("SELECT id, supplier_code FROM suppliers")}

        # ---- 元器件 + 库存 ----
        part_info = {}  # part_code -> (id, purchase_price, unit, stock_warning_value)
        for row in PARTS:
            code, name, model, spec, unit, purchase, retail, warning, sup_code, category, desc = row
            cur = conn.execute(
                "INSERT INTO parts (part_code, name, model, specification, unit, purchase_price, "
                "suggested_retail_price, stock_warning_value, supplier_id, category, description) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (code, name, model, spec, unit, purchase, retail, warning, supplier_id[sup_code], category, desc),
            )
            part_info[code] = (cur.lastrowid, purchase, unit, warning)

            if code in INVENTORY_LOW_STOCK:
                qty, loc = INVENTORY_LOW_STOCK[code]
            else:
                qty = int(warning * random.uniform(1.2, 3.0))
                loc = f"{random.choice('ABCDE')}-{random.randint(1, 4):02d}-{random.randint(1, 9):02d}"
            conn.execute(
                "INSERT INTO inventory (part_id, current_quantity, safety_stock, warehouse_location) "
                "VALUES (?, ?, ?, ?)", (part_info[code][0], qty, warning, loc)
            )

        # ---- 采购订单（62 笔：55 笔历史 + 2 笔已审核 + 5 笔待审核） ----
        part_codes = list(part_info.keys())

        def insert_order(status: int, order_dt: datetime) -> None:
            # 订单编号规则与 procurement-order 子Agent约定一致：PO + 年月日 + 3位序号
            date_str = order_dt.strftime("%Y%m%d")
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM purchase_orders WHERE order_number LIKE ?",
                (f"PO{date_str}%",),
            ).fetchone()["n"]
            order_number = f"PO{date_str}{n + 1:03d}"

            k = random.randint(1, 5)
            chosen = random.sample(part_codes, k)
            total = 0.0
            detail_rows = []
            for pc in chosen:
                pid, purchase, unit, _ = part_info[pc]
                qty = _random_quantity(unit)
                price = round(purchase * random.uniform(0.92, 1.08), 2)
                total += qty * price
                detail_rows.append((pid, qty, price))
            total = round(total, 2)
            remark = random.choice(ORDER_REMARKS)

            cur = conn.execute(
                "INSERT INTO purchase_orders (order_number, total_amount, status, remark, order_time) "
                "VALUES (?, ?, ?, ?, ?)",
                (order_number, total, status, remark, order_dt.strftime("%Y-%m-%d %H:%M:%S")),
            )
            for pid, qty, price in detail_rows:
                conn.execute(
                    "INSERT INTO order_details (order_id, part_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
                    (cur.lastrowid, pid, qty, price),
                )

        # 55 笔历史订单：2026-03-02 ~ 2026-09-04，状态偏向已完成/已收货
        history_status = [4] * 28 + [3] * 10 + [2] * 8 + [1] * 9
        random.shuffle(history_status)
        base = datetime(2026, 3, 2)
        for i in range(55):
            day = base + timedelta(days=random.randint(0, 184))  # 03-02 ~ 09-02
            insert_order(history_status[i], day.replace(hour=random.randint(9, 18), minute=random.randint(0, 59)))

        # 2 笔已审核（09-05 ~ 09-07）：走完审批、尚未发货
        insert_order(1, datetime(2026, 9, 5, 10, 23))
        insert_order(1, datetime(2026, 9, 7, 15, 41))

        # 5 笔待审核（09-08 ~ 09-12）：HITL 审批流演示对象
        for d in range(8, 13):
            insert_order(0, datetime(2026, 9, d, random.randint(9, 17), random.randint(0, 59)))

    # 打印统计，方便启动时确认种子数据完整
    conn = get_conn()
    stats = {
        t: conn.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()["n"]
        for t in ("suppliers", "parts", "inventory", "purchase_orders", "order_details")
    }
    conn.close()
    print(f"[mock_erp] 种子数据已灌入: {stats}")
