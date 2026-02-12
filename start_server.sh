#!/bin/bash
echo "Compilando servidor..."
javac --release 8 server/*.java

if [ $? -ne 0 ]; then
    echo "Error de compilacion."
    read -p "Presiona Enter para continuar..."
    exit 1
fi

echo "Iniciando servidor..."
echo "Entra a http://localhost:8080 en tu navegador"
echo "Presiona Ctrl+C para detener"
java -cp server GameServer
read -p "Presiona Enter para continuar..."
