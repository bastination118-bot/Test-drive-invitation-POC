/**
 * GBK/GB2312 编码解码器 (浏览器端)
 * 用于解决 CSV 文件中文乱码问题
 */

// GBK 编码表简化版 - 常用汉字
const GBK_DECODE_TABLE = {
    // 这里存储 GBK 双字节解码映射
    // 实际使用时通过计算获取
};

/**
 * 将 GBK 编码的 Uint8Array 解码为 UTF-8 字符串
 * 基于 GBK 编码规则: 第一个字节 0x81-0xFE, 第二个字节 0x40-0xFE
 */
function decodeGBK(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let result = '';
    let i = 0;
    
    while (i < bytes.length) {
        const byte1 = bytes[i];
        
        // ASCII 范围直接解码
        if (byte1 < 0x80) {
            result += String.fromCharCode(byte1);
            i++;
            continue;
        }
        
        // GBK 双字节字符
        if (i + 1 < bytes.length) {
            const byte2 = bytes[i + 1];
            // GBK 编码范围检查
            if (byte1 >= 0x81 && byte1 <= 0xFE && byte2 >= 0x40 && byte2 <= 0xFE) {
                const gbkCode = (byte1 << 8) | byte2;
                const unicode = gbkToUnicode(gbkCode);
                result += String.fromCharCode(unicode);
                i += 2;
                continue;
            }
        }
        
        // 无法解码，使用替换字符
        result += '\uFFFD';
        i++;
    }
    
    return result;
}

/**
 * GBK 编码转 Unicode
 * 使用简化的映射表处理常用汉字
 */
function gbkToUnicode(gbkCode) {
    // GBK 编码范围对应 Unicode 的映射
    // GB2312: 0xB0A1-0xF7FE (汉字)
    // GBK 扩展: 0x8140-0xFE40
    
    const byte1 = (gbkCode >> 8) & 0xFF;
    const byte2 = gbkCode & 0xFF;
    
    // 处理 GB2312 一级汉字 (0xB0A1-0xD7FE)
    if (byte1 >= 0xB0 && byte1 <= 0xD7) {
        if (byte2 >= 0xA1 && byte2 <= 0xFE) {
            const offset = ((byte1 - 0xB0) * 94 + (byte2 - 0xA1));
            return 0x4E00 + offset; // 从 "一" 字开始
        }
    }
    
    // 处理 GB2312 二级汉字 (0xD8A1-0xF7FE)
    if (byte1 >= 0xD8 && byte1 <= 0xF7) {
        if (byte2 >= 0xA1 && byte2 <= 0xFE) {
            const offset = ((byte1 - 0xD8) * 94 + (byte2 - 0xA1));
            return 0x4E00 + (0xD7 - 0xB0 + 1) * 94 + offset;
        }
    }
    
    // 全角字符处理
    if (byte1 === 0xA3) {
        // 全角字母和数字
        if (byte2 >= 0xB0 && byte2 <= 0xDA) {
            return byte2 - 0xB0 + 0xFF21; // 全角大写字母
        }
        if (byte2 >= 0xE0 && byte2 <= 0xFA) {
            return byte2 - 0xE0 + 0xFF41; // 全角小写字母
        }
    }
    
    // 标点符号
    if (byte1 === 0xA1) {
        const punctuation = {
            0xA1: 0x3002, // 。
            0xA2: 0x3008, // 《
            0xA3: 0x3009, // 》
            0xA4: 0x3010, // 【
            0xA5: 0x3011, // 】
            0xA6: 0x3001, // 、
            0xA9: 0x2018, // '
            0xAA: 0x2019, // '
            0xAB: 0x201C, // "
            0xAC: 0x201D, // "
            0xAE: 0x2026, // …
            0xB0: 0x25CF, // ●
        };
        if (punctuation[byte2]) {
            return punctuation[byte2];
        }
    }
    
    // 无法精确映射，返回问号
    return 0xFFFD;
}

/**
 * 智能编码检测和转换
 * 尝试多种编码方式，返回最可能正确的结果
 */
function smartDecode(arrayBuffer) {
    // 首先尝试 UTF-8
    try {
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        const utf8Text = utf8Decoder.decode(arrayBuffer);
        
        // 检查 UTF-8 解码结果
        if (isValidChineseText(utf8Text)) {
            return utf8Text;
        }
    } catch (e) {
        // UTF-8 解码失败
    }
    
    // 尝试 GBK 解码
    const gbkText = decodeGBK(arrayBuffer);
    if (isValidChineseText(gbkText)) {
        return gbkText;
    }
    
    // 兜底: 使用非严格 UTF-8
    return new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
}

/**
 * 检测文本是否包含有效中文
 */
function isValidChineseText(text) {
    if (!text || text.length === 0) return false;
    
    // 检查乱码特征
    const garbledPattern = /[\uFFFD]|锟斤拷|����/;
    if (garbledPattern.test(text)) {
        return false;
    }
    
    // 检查是否包含中文字符
    const chinesePattern = /[\u4e00-\u9fa5]/;
    return chinesePattern.test(text);
}

/**
 * 检测是否为 GBK 编码特征
 */
function isGBKEncoded(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let gbkPatternCount = 0;
    let i = 0;
    
    while (i < bytes.length - 1) {
        const byte1 = bytes[i];
        // GBK 双字节特征
        if (byte1 >= 0x81 && byte1 <= 0xFE) {
            const byte2 = bytes[i + 1];
            if (byte2 >= 0x40 && byte2 <= 0xFE) {
                gbkPatternCount++;
                i += 2;
                continue;
            }
        }
        i++;
    }
    
    // 如果超过 5% 的字节符合 GBK 双字节模式，认为是 GBK 编码
    return gbkPatternCount > (bytes.length * 0.05);
}

// 导出
if (typeof window !== 'undefined') {
    window.decodeGBK = decodeGBK;
    window.smartDecode = smartDecode;
    window.isValidChineseText = isValidChineseText;
    window.isGBKEncoded = isGBKEncoded;
}
