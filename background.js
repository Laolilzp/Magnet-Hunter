// 状态标记
let isProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "start_process") {
        if (!isProcessing) {
            runTwoStageProcess();
        }
    } else if (message.action === "confirm_extract") {
        // 接收到用户在页面上点的“确认”指令
        extractAllParallel();
    }
});

// === 阶段一：极速唤醒 ===
async function runTwoStageProcess() {
    isProcessing = true;
    
    // 1. 获取所有标签页
    const tabs = await chrome.tabs.query({ currentWindow: true });
    
    // 记录起点，最后要切回来
    const startTab = tabs.find(t => t.active);

    // 2. 快速遍历激活
    // 这里我们把等待时间缩短到 150ms，只要浏览器开始渲染即可，无需等全加载
    for (const tab of tabs) {
        // 跳过系统页
        if (!tab.url || tab.url.startsWith('edge://') || tab.url.startsWith('chrome://')) continue;

        await chrome.tabs.update(tab.id, { active: true });
        await sleep(150); // 极速切换，给浏览器一点喘息时间读入内存
    }

    // 3. 切回最初的页面
    if (startTab) {
        await chrome.tabs.update(startTab.id, { active: true });
    }

    // 4. 在当前页面注入一个确认框
    // 因为 popup 早就关了，我们需要在页面里利用 alert/confirm 和用户交互
    if (startTab) {
        chrome.scripting.executeScript({
            target: { tabId: startTab.id },
            func: showConfirmDialog
        });
    }
    
    isProcessing = false;
}

// === 阶段二：并行提取 (无需切换) ===
async function extractAllParallel() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    let allMagnets = new Set();
    
    // 创建一个并行任务列表
    const extractionPromises = tabs.map(async (tab) => {
        // 过滤系统页
        if (!tab.url || tab.url.startsWith('edge://') || tab.url.startsWith('chrome://')) return;

        try {
            // 直接在后台对所有标签页同时执行脚本，这比切换页面快得多
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractMagnetsFromPage
            });

            if (results && results[0] && results[0].result) {
                results[0].result.forEach(link => allMagnets.add(link));
            }
        } catch (e) {
            console.log(`Tab ${tab.id} 提取失败 (可能是未加载完全):`, e);
        }
    });

    // 等待所有页面提取完毕
    await Promise.all(extractionPromises);

    downloadResults(allMagnets);
}

// --- 注入到页面的函数：显示确认框 ---
function showConfirmDialog() {
    // 延时一点点，确保切屏动画结束
    setTimeout(() => {
        const userConfirmed = confirm("【Magnet Hunter】\n\n所有页面已激活完毕！\n\n点击 [确定] 立即开始后台提取并下载。\n点击 [取消] 放弃操作。");
        if (userConfirmed) {
            // 发消息回后台
            chrome.runtime.sendMessage({ action: "confirm_extract" });
        }
    }, 200);
}

// --- 注入到页面的函数：提取逻辑 (增强版) ---
function extractMagnetsFromPage() {
    const magnets = [];
    const prefix = "magnet:?xt=urn:btih";

    // 1. 抓取所有超链接 (a href)
    const links = document.querySelectorAll('a');
    for (let link of links) {
        if (link.href && link.href.startsWith(prefix)) {
            magnets.push(link.href);
        }
    }

    // 2. 抓取纯文本 (暴力正则，处理单页多链)
    // 使用 document.body.innerText 可能漏掉隐藏元素，使用 innerHTML 配合正则更暴力但全面
    // 考虑到性能，innerText 通常足够，除非链接在隐藏代码块里
    const text = document.body.innerText;
    
    // 正则解释：
    // magnet:\?xt=urn:btih:  -> 固定开头
    // [a-zA-Z0-9]+           -> 哈希值部分
    const regex = /magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}/gi; 
    
    const matches = text.match(regex);
    if (matches) {
        matches.forEach(m => magnets.push(m));
    }

    return magnets;
}

// --- 下载逻辑 ---
function downloadResults(magnetSet) {
    const magnetArray = Array.from(magnetSet);
    
    if (magnetArray.length === 0) {
        alert("未找到任何磁力链接。"); // 这里其实无法alert，因为是在后台运行，但无所谓
        return;
    }

    const content = magnetArray.join('\n');
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
    
    const now = new Date();
    const timeStr = `${now.getHours()}_${now.getMinutes()}_${now.getSeconds()}`;

    chrome.downloads.download({
        url: dataUrl,
        filename: `磁力全集_${magnetArray.length}条_${timeStr}.txt`,
        saveAs: true
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}