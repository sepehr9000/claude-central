set allData to ""

if application "iTerm2" is running then
	tell application "iTerm2"
		repeat with w in windows
			try
				set wId to "iterm-" & (id of w as text)
				set b to bounds of w
				set bStr to (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
				set tc to contents of current session of current tab of w
				set tcLen to length of tc
				if tcLen > 500 then
					set lastBit to text (tcLen - 499) thru tcLen of tc
				else
					set lastBit to tc
				end if
				set allData to allData & wId & "|" & bStr & "|" & lastBit & "<<<SEP>>>"
			end try
		end repeat
	end tell
end if

if application "Terminal" is running then
	tell application "Terminal"
		repeat with i from 1 to count of windows
			try
				set w to window i
				set wId to "term-" & (id of w as text)
				set b to bounds of w
				set bStr to (item 1 of b as text) & "," & (item 2 of b as text) & "," & (item 3 of b as text) & "," & (item 4 of b as text)
				set tc to contents of selected tab of w
				set tcLen to length of tc
				if tcLen > 500 then
					set lastBit to text (tcLen - 499) thru tcLen of tc
				else
					set lastBit to tc
				end if
				set allData to allData & wId & "|" & bStr & "|" & lastBit & "<<<SEP>>>"
			end try
		end repeat
	end tell
end if

return allData
