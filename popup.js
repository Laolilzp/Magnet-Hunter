document.getElementById('startBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "start_process" });
    window.close(); // 立即关闭弹窗，开始干活
});