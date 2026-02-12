@echo off
echo Compilando servidor...
javac --release 8 server/*.java

if %errorlevel% neq 0 (
    echo Error de compilacion.
    pause
    exit /b %errorlevel%
)

echo Iniciando servidor...
echo Entra a http://localhost:8080 en tu navegador
echo Presiona Ctrl+C para detener
java -cp server GameServer
pause