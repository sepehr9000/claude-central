

function addToDisplay(num) {
    console.log(num);
    var displayElement = document.getElementsByClassName("display")[0];
    console.log(displayElement.value);
    displayElement.value += num;    
}

function clearDisplay() {
    var displayElement = document.getElementsByClassName("display")[0];
    displayElement.value = "";
}

function calculate() {
    var displayElement = document.getElementsByClassName("display")[0];
    var string = displayElement.value;
    var operator = string.match(/[+\-*\/]/)[0];
    console.log(operator);

    var [leftOperand, ignore, rightOperand] = string.split(/([+\-*\/])/);

    leftOperand = parseFloat(leftOperand);
    rightOperand = parseFloat(rightOperand);

    console.log(leftOperand, rightOperand, operator);
    console.log(typeof leftOperand, typeof rightOperand, typeof operator);
        switch (operator) {
            case '+':
                displayElement.value = leftOperand + rightOperand;
                break;
            case '-':
                displayElement.value = leftOperand - rightOperand;
                break;
            case '*':
                displayElement.value = leftOperand * rightOperand;
                break;
            case '/':
                displayElement.value = leftOperand / rightOperand;
                break;
            default:
                displayElement.value = "Invalid operator";
                break;
        }
}