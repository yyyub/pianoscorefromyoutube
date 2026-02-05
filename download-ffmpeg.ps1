# FFmpeg 다운로드 및 설치 스크립트
# PowerShell에서 실행: .\download-ffmpeg.ps1

$ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$downloadPath = "$PSScriptRoot\ffmpeg-temp.zip"
$extractPath = "$PSScriptRoot\ffmpeg-extracted"

Write-Host "FFmpeg 다운로드 중..." -ForegroundColor Green
Invoke-WebRequest -Uri $ffmpegUrl -OutFile $downloadPath

Write-Host "압축 해제 중..." -ForegroundColor Green
Expand-Archive -Path $downloadPath -DestinationPath $extractPath -Force

Write-Host "bin 폴더 찾는 중..." -ForegroundColor Green
$binFolder = Get-ChildItem -Path $extractPath -Recurse -Directory -Filter "bin" | Select-Object -First 1

if ($binFolder) {
    $targetPath = "C:\ffmpeg\bin"
    Write-Host "bin 폴더를 $targetPath 로 복사 중..." -ForegroundColor Green

    New-Item -ItemType Directory -Path "C:\ffmpeg" -Force | Out-Null
    Copy-Item -Path $binFolder.FullName -Destination "C:\ffmpeg" -Recurse -Force

    Write-Host "`n✅ FFmpeg 설치 완료!" -ForegroundColor Green
    Write-Host "C:\ffmpeg\bin 을 PATH에 추가하세요." -ForegroundColor Yellow
    Write-Host "`n다음 명령어로 확인:" -ForegroundColor Cyan
    Write-Host "  ffmpeg -version`n" -ForegroundColor White
} else {
    Write-Host "❌ bin 폴더를 찾을 수 없습니다." -ForegroundColor Red
}

# 임시 파일 정리
Remove-Item $downloadPath -Force
Remove-Item $extractPath -Recurse -Force

Write-Host "`n터미널을 재시작한 후 ffmpeg -version 으로 확인하세요." -ForegroundColor Yellow
