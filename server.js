const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const app = express();

// Configuración de Multer para almacenar en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Configuración básica de Express
app.use(express.static('public'));
app.use(express.json());

// Función para extraer texto del PDF usando pdf-parse
async function extractTextFromPDF(buffer) {
    try {
        const data = await pdfParse(buffer);
        return data.text;
    } catch (error) {
        throw new Error('Error al extraer texto del PDF: ' + error.message);
    }
}

function extractQuestionsAndAnswers(text) {
    const lines = text.split('\n');

    // List of patterns to try for detecting questions and options
    const patterns = [
        {
            questionPattern: /^\d+\s*|\s\d+\s*$/, // "1\n" or " 1 "
            optionPattern: /^[a-zA-Z]\)\s*/  // "a) "
        },
        {
            questionPattern: /^\d+[\.\-)\]]\s*/, // "1. ", "1- ", "1) ", "1] "
            optionPattern: /^[a-zA-Z][\.\-)\]]\s*/  // "a. ", "a- ", "a) ", "a] "
        },
        {
            questionPattern: /^\d+\:\s*/, // "1:"
            optionPattern: /^[a-zA-Z]\)\s*/  // "a) "
        },
        {
            questionPattern: /^\d+\s*$/, // "1"
            optionPattern: /^[a-zA-Z]\)\s*/  // "a)"
        },
        {
            questionPattern: /^\d+\,\s*/, // "1,"
            optionPattern: /^[a-zA-Z]\,\s*/  // "a, "
        },
        {
            questionPattern: /^\d+\s*:|\s\d+\s*:/, // "1:" or ":1"
            optionPattern: /^[a-zA-Z]\)\s*/  // "a) "
        }
    ];

    let bestPattern = null;
    let maxMatches = 0;

    patterns.forEach(pattern => {
        let matches = 0;
        let { questionPattern, optionPattern } = pattern;
        
        lines.forEach(line => {
            if (questionPattern.test(line.trim()) || optionPattern.test(line.trim())) {
                matches++;
            }
        });

        if (matches > maxMatches) {
            maxMatches = matches;
            bestPattern = pattern;
        }
    });

    if (!bestPattern) {
        throw new Error('No se encontraron patrones válidos.');
    }

    // Extract questions and answers using the best pattern
    let questions = [];
    let { questionPattern, optionPattern } = bestPattern;
    let currentQuestion = null;
    let currentOptions = [];
    let correctOption = null;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        let line = lines[lineIndex].trim();

        // Filter irrelevant lines
        if (!line || line.toLowerCase().includes('nombre') || line.toLowerCase().includes('dni') || line.toLowerCase().includes('publicidad')) {
            continue;
        }

        if (questionPattern.test(line) && !optionPattern.test(line)) {
            if (currentQuestion) {
                // Push the current question with its options
                questions.push({
                    question: currentQuestion,
                    options: currentOptions,
                    correctOption: correctOption !== null ? correctOption : 0
                });
            }
            // Start new question
            currentQuestion = line;
            currentOptions = [];
            correctOption = null;
        } else if (optionPattern.test(line)) {
            currentOptions.push(line);
        } else if (currentQuestion) {
            // Continue current question with new line
            currentQuestion += ' ' + line;
        }
    }

    // Push the last question after loop
    if (currentQuestion) {
        questions.push({
            question: currentQuestion,
            options: currentOptions,
            correctOption: correctOption !== null ? correctOption : 0
        });
    }

    // Check if more than half of the questions have no options and try another pattern
    let questionsWithNoOptions = questions.filter(q => q.options.length === 0).length;
    if (questionsWithNoOptions > questions.length / 2) {
        patterns.splice(patterns.indexOf(bestPattern), 1);
        if (patterns.length > 0) {
            return extractQuestionsAndAnswers(text);
        } else {
            throw new Error('No se encontraron patrones válidos con opciones.');
        }
    }

    return questions;
}

// Ruta para subir archivos PDF y extraer preguntas y respuestas
app.post('/upload', upload.single('fileInput'), async (req, res) => {
    try {
        if (req.file && req.file.mimetype === 'application/pdf') {
            const buffer = req.file.buffer;
            const textContent = await extractTextFromPDF(buffer);
            const questions = extractQuestionsAndAnswers(textContent);

            if (questions.length === 0) {
                throw new Error('No se pudieron extraer preguntas válidas del PDF.');
            }

            res.json({ success: true, questions });
        } else {
            res.status(400).json({ success: false, message: 'Por favor, sube un archivo PDF' });
        }
    } catch (err) {
        console.error('Error al procesar el archivo PDF:', err);
        res.status(500).json({ success: false, message: 'Error al procesar el archivo PDF: ' + err.message });
    }
});

// Ruta para guardar el cuestionario y generar el HTML para descargar
app.post('/save', (req, res) => {
    const { questions } = req.body;
    const htmlContent = generateHTML(questions);
    const outputFilePath = path.join(__dirname, 'public', 'quiz.html');

    // Escribir el archivo HTML generado
    fs.writeFileSync(outputFilePath, htmlContent);

    // Enviar el archivo HTML generado como respuesta para su descarga
    res.setHeader('Content-Disposition', 'attachment; filename=quiz.html');
    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);

    // Eliminar el archivo temporal después de enviar la respuesta
    setTimeout(() => {
        fs.unlink(outputFilePath, (err) => {
            if (err) {
                console.error('Error al eliminar el archivo HTML:', err);
            }
        });
    }, 10000); // Ajusta el tiempo según sea necesario
});

// Función para generar HTML con las preguntas y respuestas
function generateHTML(questions) {
    let htmlContent = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test</title>
        <style>
            body {
                font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
                background-color: #242424;
                margin: 0;
                padding: 0;
                color: rgba(255, 255, 255, 0.87);
            }
            .container {
                width: 80%;
                margin: 50px auto;
                background: #212121;
                padding: 20px;
                box-shadow: 0 0 10px rgba(14, 41, 197, 0.1);
                border-radius: 5px;
            }
            h1 {
                text-align: center;
                color: white;
            }
            .question {
                margin-bottom: 20px;
                padding: 15px;
                border: 5px solid #171717;
                border-radius: 8px;
                background-color: #2a2a2a; /* Color de fondo para resaltar la pregunta */
                position: relative;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); /* Sombra para hacer que el recuadro destaque más */
            }
            .questionText {
                font-size: 1.2em;
                color: #fff;
            }
            .optionContainer {
                display: flex;
                align-items: center;
                margin-bottom: 10px;
            }
            .optionContainer input[type="radio"] {
                margin-right: 10px;
            }
            .optionContainer label {
                flex-grow: 1;
                background-color: #333;
                color: #fff;
                border: 1px solid #555;
                padding: 10px;
                border-radius: 4px;
                box-sizing: border-box;
                position: relative;
                display: flex;
                align-items: center;
            }
            button {
                background-color: #646cff;
                color: white;
                border: none;
                padding: 10px 20px;
                cursor: pointer;
                border-radius: 5px;
                margin-top: 10px;
            }
            button:hover {
                background-color: #535bf2;
            }
            .tick, .cross {
                margin-right: 10px;
                font-size: 1.5em;
                display: none;
            }
            .tick { color: green; }
            .cross { color: red; }
            .result {
                margin-top: 20px;
                font-size: 1.2em;
                color: white;
            }
            .correct { color: green; }
            .incorrect { color: red; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Test</h1>
            <form id="quizForm">
    `;

    questions.forEach((q, index) => {
        htmlContent += `
            <div class="question" id="question${index}">
                <div class="questionText">${q.question}</div>
                ${q.options.map((option, i) => `
                    <div class="optionContainer">
                        <span class="tick" id="tick${index}o${i}">✔️</span>
                        <span class="cross" id="cross${index}o${i}">❌</span>
                        <input type="radio" id="q${index}o${i}" name="q${index}" value="${i}">
                        <label for="q${index}o${i}">${option}</label>
                    </div>
                `).join('')}
                <button type="button" onclick="checkAnswer(${index})">Resolver Pregunta</button>
            </div>
        `;
    });

    htmlContent += `
            </form>
            <button type="button" onclick="checkTest()">Resolver Test</button>
            <div id="result" class="result"></div>
        </div>
        <script>
            const questions = ${JSON.stringify(questions)};
            function checkAnswer(index) {
                const selectedOption = document.querySelector('input[name="q' + index + '"]:checked');
                if (selectedOption) {
                    const selectedValue = parseInt(selectedOption.value);
                    const tickElement = document.getElementById('tick' + index + 'o' + selectedValue);
                    const crossElement = document.getElementById('cross' + index + 'o' + selectedValue);
                    hideAllMarks(index);
                    if (selectedValue === questions[index].correctOption) {
                        tickElement.style.display = 'inline';
                        tickElement.style.color = 'green';
                    } else {
                        crossElement.style.display = 'inline';
                        crossElement.style.color = 'red';
                    }
                }
            }
            function checkTest() {
                let correctCount = 0;
                let incorrectCount = 0;
                let unansweredCount = 0;
                questions.forEach((_, index) => {
                    const selectedOption = document.querySelector('input[name="q' + index + '"]:checked');
                    hideAllMarks(index);
                    if (selectedOption) {
                        const selectedValue = parseInt(selectedOption.value);
                        const tickElement = document.getElementById('tick' + index + 'o' + selectedValue);
                        const crossElement = document.getElementById('cross' + index + 'o' + selectedValue);
                        if (selectedValue === questions[index].correctOption) {
                            tickElement.style.display = 'inline';
                            tickElement.style.color = 'green';
                            correctCount++;
                        } else {
                            crossElement.style.display = 'inline';
                            crossElement.style.color = 'red';
                            incorrectCount++;
                        }
                    } else {
                        unansweredCount++;
                    }
                });
                const resultElement = document.getElementById('result');
                resultElement.innerHTML = 'Aciertos: <span class="correct">' + correctCount + '</span> - Fallos: <span class="incorrect">' + incorrectCount + '</span> - No contestadas: ' + unansweredCount;
            }
            function hideAllMarks(index) {
                questions[index].options.forEach((_, i) => {
                    const tickElement = document.getElementById('tick' + index + 'o' + i);
                    const crossElement = document.getElementById('cross' + index + 'o' + i);
                    tickElement.style.display = 'none';
                    crossElement.style.display = 'none';
                });
            }
        </script>
    </body>
    </html>
    `;

    return htmlContent;
}

// Puerto del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`);
});