import { ESP32C3ROM } from "./esp32c3.js";
export class ESP32H4ROM extends ESP32C3ROM {
    CHIP_NAME = "ESP32-H4";
    IMAGE_CHIP_ID = 28;
    USES_MAGIC_VALUE = false;
    IROM_MAP_START = 0x42000000;
    IROM_MAP_END = 0x42800000;
    DROM_MAP_START = 0x42800000;
    DROM_MAP_END = 0x43000000;
    BOOTLOADER_FLASH_OFFSET = 0x2000;
    SPI_REG_BASE = 0x60099000;
    SPI_USR_OFFS = 0x18;
    SPI_USR1_OFFS = 0x1c;
    SPI_USR2_OFFS = 0x20;
    SPI_MOSI_DLEN_OFFS = 0x24;
    SPI_MISO_DLEN_OFFS = 0x28;
    SPI_W0_OFFS = 0x58;
    UART_DATE_REG_ADDR = 0x60012000 + 0x7c;
    EFUSE_BASE = 0x600b1800;
    EFUSE_BLOCK1_ADDR = this.EFUSE_BASE + 0x044;
    MAC_EFUSE_REG = this.EFUSE_BASE + 0x044;
    EFUSE_RD_REG_BASE = this.EFUSE_BASE + 0x030;
    EFUSE_PURPOSE_KEY0_REG = this.EFUSE_BASE + 0x34;
    EFUSE_PURPOSE_KEY0_SHIFT = 0;
    EFUSE_PURPOSE_KEY1_REG = this.EFUSE_BASE + 0x34;
    EFUSE_PURPOSE_KEY1_SHIFT = 5;
    EFUSE_PURPOSE_KEY2_REG = this.EFUSE_BASE + 0x34;
    EFUSE_PURPOSE_KEY2_SHIFT = 10;
    EFUSE_PURPOSE_KEY3_REG = this.EFUSE_BASE + 0x34;
    EFUSE_PURPOSE_KEY3_SHIFT = 15;
    EFUSE_PURPOSE_KEY4_REG = this.EFUSE_BASE + 0x34;
    EFUSE_PURPOSE_KEY4_SHIFT = 20;
    EFUSE_PURPOSE_KEY5_REG = this.EFUSE_BASE + 0x34;
    EFUSE_PURPOSE_KEY5_SHIFT = 25;
    EFUSE_DIS_DOWNLOAD_MANUAL_ENCRYPT_REG = this.EFUSE_RD_REG_BASE;
    EFUSE_DIS_DOWNLOAD_MANUAL_ENCRYPT = 1 << 14;
    EFUSE_SPI_BOOT_CRYPT_CNT_REG = this.EFUSE_BASE + 0x030;
    EFUSE_SPI_BOOT_CRYPT_CNT_MASK = 0x7 << 23;
    EFUSE_SECURE_BOOT_EN_REG = this.EFUSE_BASE + 0x038;
    EFUSE_SECURE_BOOT_EN_MASK = 1 << 5;
    EFUSE_FORCE_USE_KEY_MANAGER_KEY_REG = this.EFUSE_BASE + 0x038;
    EFUSE_FORCE_USE_KEY_MANAGER_KEY_SHIFT = 19;
    FORCE_USE_KEY_MANAGER_VAL_XTS_AES_KEY = 2;
    PURPOSE_VAL_XTS_AES256_KEY_1 = 2;
    PURPOSE_VAL_XTS_AES256_KEY_2 = 3;
    PURPOSE_VAL_XTS_AES128_KEY = 4;
    FLASH_ENCRYPTED_WRITE_ALIGN = 16;
    FLASH_FREQUENCY = {
        "48m": 0xf,
        "24m": 0x0,
        "16m": 0x1,
        "12m": 0x2,
    };
    MEMORY_MAP = [
        [0x00000000, 0x00010000, "PADDING"],
        [0x42000000, 0x44000000, "DROM"],
        [0x40810000, 0x40860000, "DRAM"],
        [0x40810000, 0x40860000, "BYTE_ACCESSIBLE"],
        [0x40000000, 0x40050000, "DROM_MASK"],
        [0x40000000, 0x40050000, "IROM_MASK"],
        [0x42000000, 0x44000000, "IROM"],
        [0x40810000, 0x40860000, "IRAM"],
        [0x50000000, 0x50004000, "RTC_IRAM"],
        [0x50000000, 0x50004000, "RTC_DRAM"],
        [0x60000000, 0x60100000, "MEM_INTERNAL2"],
    ];
    UF2_FAMILY_ID = 0x9e0baa8a;
    EFUSE_MAX_KEY = 5;
    KEY_PURPOSES = {
        0: "USER/EMPTY",
        1: "ECDSA_KEY",
        2: "XTS_AES_256_KEY_FLASH_1",
        3: "XTS_AES_256_KEY_FLASH_2",
        4: "XTS_AES_128_KEY",
        5: "HMAC_DOWN_ALL",
        6: "HMAC_DOWN_JTAG",
        7: "HMAC_DOWN_DIGITAL_SIGNATURE",
        8: "HMAC_UP",
        9: "SECURE_BOOT_DIGEST0",
        10: "SECURE_BOOT_DIGEST1",
        11: "SECURE_BOOT_DIGEST2",
        12: "KM_INIT_KEY",
        13: "XTS_AES_256_KEY_PSRAM_1",
        14: "XTS_AES_256_KEY_PSRAM_2",
        15: "XTS_AES_128_KEY_PSRAM",
        16: "ECDSA_KEY_P192",
        17: "ECDSA_KEY_P384_L",
        18: "ECDSA_KEY_P384_H",
    };
    async getPkgVersion(loader) {
        const numWord = 4;
        return ((await loader.readReg(this.EFUSE_BLOCK1_ADDR + 4 * numWord)) >> 12) & 0x07;
    }
    async getMinorChipVersion(loader) {
        const numWord = 3;
        return ((await loader.readReg(this.EFUSE_BLOCK1_ADDR + 4 * numWord)) >> 18) & 0x0f;
    }
    async getMajorChipVersion(loader) {
        const numWord = 3;
        return ((await loader.readReg(this.EFUSE_BLOCK1_ADDR + 4 * numWord)) >> 22) & 0x03;
    }
    async getChipRevision(loader) {
        const major = await this.getMajorChipVersion(loader);
        const minor = await this.getMinorChipVersion(loader);
        return major * 100 + minor;
    }
    async getChipDescription(loader) {
        const pkgVer = await this.getPkgVersion(loader);
        const desc = pkgVer === 0 ? "ESP32-H4 (QFN40)" : "Unknown ESP32-H4";
        const majorRev = await this.getMajorChipVersion(loader);
        const minorRev = await this.getMinorChipVersion(loader);
        return `${desc} (revision v${majorRev}.${minorRev})`;
    }
    async getChipFeatures(loader) {
        return ["BT 5 (LE)", "IEEE802.15.4", "Dual Core", "96MHz"];
    }
    async getCrystalFreq(loader) {
        return 32;
    }
    async getKeyBlockPurpose(loader, keyBlock) {
        if (keyBlock < 0 || keyBlock > this.EFUSE_MAX_KEY) {
            throw new Error(`Valid key block numbers must be in range 0-${this.EFUSE_MAX_KEY}`);
        }
        const regShiftDictionary = [
            [this.EFUSE_PURPOSE_KEY0_REG, this.EFUSE_PURPOSE_KEY0_SHIFT],
            [this.EFUSE_PURPOSE_KEY1_REG, this.EFUSE_PURPOSE_KEY1_SHIFT],
            [this.EFUSE_PURPOSE_KEY2_REG, this.EFUSE_PURPOSE_KEY2_SHIFT],
            [this.EFUSE_PURPOSE_KEY3_REG, this.EFUSE_PURPOSE_KEY3_SHIFT],
            [this.EFUSE_PURPOSE_KEY4_REG, this.EFUSE_PURPOSE_KEY4_SHIFT],
            [this.EFUSE_PURPOSE_KEY5_REG, this.EFUSE_PURPOSE_KEY5_SHIFT],
        ];
        const [reg, shift] = regShiftDictionary[keyBlock];
        const registerValue = await loader.readReg(reg);
        return (registerValue >> shift) & 0x1f;
    }
    checkSpiConnection(loader, spiConnection) {
        if (!spiConnection.every((pin) => pin >= 0 && pin <= 39)) {
            throw new Error("SPI Pin numbers must be in the range 0-39.");
        }
        if (spiConnection.some((pin) => pin === 13 || pin === 14)) {
            loader.info("GPIO pins 13 and 14 are used by USB-Serial/JTAG, " + "consider using other pins for SPI flash connection.");
        }
    }
}
