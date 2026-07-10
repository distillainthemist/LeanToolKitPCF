# LeanToolKit_PCF  
  
  
**Context**  
Building off the success of the fishbone PCF, I want to develop a PCF called “LeanToolKit”. It will provide a set of custom components that can be used to build lean boards repeatedly, with professional modern styling. These will be discrete components compiled into one importable managed solution.  
  
**Architecture**  
Each component is standalone component fulfilling one function. It should be driven by simple inputs, with the key data presented/interacted with managed by a JSON format, with consistent approach to the JSON structure across components, so JSON may be easily translated across elements, e.g. a cause captured in a fish bone has common JSON elements to a cause captured through a root cause tree. The components should be setup with an inputJSON field for preload of data, a reset property that resets to the preloaded data, and an outputJSON that presents the edited data. This is to enable load from and save to Dataverse tables.  
There will be paints in different components where it is logical to capture or display an action. Actions shall have the follow basic format - issue, description, who, due date, status, comments, escalation. The action shall have two further fields that are not normally visualised - a context field which provides information on how to visualise/place within the component and the source component, and a whoid, which is a guid unique identifier. If a component requires action capture, it should be supplied with a list who and whoids. Escalation is used to flag reporting into a higher level interface or lean board.  
  
**User Interface**  
A Flat 2.0 UI design approach should be used (see [https://www.uxdesigninstitute.com/blog/flat-design-everything-about-it/](https://www.uxdesigninstitute.com/blog/flat-design-everything-about-it/))  
Components do not need border elements or padding - this will be managed as need as they are embedded and played out within a Canvas PowerApp.  
Via inputs, it should be possible to set key styling elements - background colour (default white), foreground/text colour (default rich black), accent and legend colours, and other colours as relevant to the element. It should also be possible to specify a font-family.  
The normal interface will be traditional mouse / keyboard, but you should allow for drag and drop interfaces, and touch interactions (tablet or touchscreen whiteboard)  
As the components are generally being laid out as part of an electronic board, intended to be naturally viewed within the viewport of a web browser, a 1.77:1 ratio should be the standard size for each component, though it should be adjustable when needed.  
  
**Components**  
  
***1 Root Causes Analysis Tools***  
These are tools that are used to manage root cause analysis and capture a categorised or hierarchically organised root causes.  
**1A. Fishbone**   
A Fishbone / Ishikawa diagram - take the current Fishbone PCF, and adjust it appropriately to align to the new common style.  
  
**1B. 5 Why’s**  
A simple template that allows a 5 why’s to be capture on 1 or more causes, with a final cause able to be selected as a root cause.  
  
**1C. Simple Fault Tree**  
A template that allow a branching tree format to map a hierarchy of causes, without specifying detail around and/or etc.  
  
**1D. Detailed Fault Tree**  
A template that allows a detailed branching tree format to map a hierarchy of causes, with logic gates and probability specification and calculations.  
  
  
***2 Process Mapping Tools***  
The are tools that are used to manage mapping of a process in a visual way.  
  
**2A Simple Process Map**  
A simple process map that allows mapping of a process.  
  
**2B SIPOC**  
The same basic functionality as the process map, but with SIPOC zones, and the ability to   
  
**2C Swimlane Process Map**  
The same basic functionality as the process map, but the ability to specify swim lanes  
  
**2D Value Stream Map**  
The most advanced form of process map, a value stream map that allow standard and customised data card capture against process map elements, and a range of standard elements.  
  
  
***3 Action Management Elements***  
These are elements that are used to manage action capture. The JSON format used to manage action data should allow  
  
**3A Simple Action List**  
A simple action table format with the format issue, action, who, due, status. There should be an option to add multiple people to an action, but then split out into discrete actions to be marked off by each person.  
  
**3B Kanban Action List**  
An alternative form to the Action List, where actions are organised in a Kanban format, with the option to split into columns based on status or issue.  
  
**3C Gantt Actions List**  
An alternative form to the Action List, where actions are visualised on a Gantt.  
  
**4 Project Management Element**  
  
**4A RACI**  
A interface for managing a RACI.  
  
**4B Benefit - Effort**  
An interface for prioritising solutions / actions, based on  benefit - effort scale.  
  
**4C Risk Assessment**  
An interface for complete a simple risk assessment according to a standard 5 x 5 matrix.  
  
**5 General Leanboard Card Elements**  
  
**5A Simple Capture Card**  
A simple card with multiple single line text entries that allows some descriptive information to be captured.  
  
**5B Advanced Capture Card**  
An advanced capture card can have custom columns and column headings, and optionally, custom numbers of rows, and optionally, custom row header. For each column, the data type can be define as text, whole number, decimal number, yes/no, selection from a list. For lists, there can be option for a two later list,   
  
**5C SQDPC / Cross Capture Card**  
This is a card that allows rating on a shift, daily or weekday basis on a shaped grid. The scope is always a month.  
  
**5D Conditions Card**  
This is a card that allows a set of conditions to be rated on a shift, daily or weekday basis, for a rolling period of seven days and a forecast for the current shift. The conditions should be customisable.  
  
**5C Heat Map Card - Image Based**  
This is a card that allows loading of a fixed image, and the ability to pin issues in a heat map format.  
  
**6 Overall Interface / Management Elements**  
  
**6A Meeting Scheduler Function**  
A component that allows you to specify the timing of a meeting (frequency, days of the week, times etc), crew roster patterns if applicable (with three possible crew types - weekday only, two alternating day shifts, four alternating continuous shifts) and determines the date time occurrences of meetings.  
  
**6B Overall Leanboard**  
A format that allows layout and display of all the various components in a custom lean board interface, with aggregated input / output data in a JSON format, and an edit / display mode, and the ability to customise colour styling on individual elements.  
  
**6C Retrieval Function**  
Where there are a series of lean meetings that cascade, it is natural to want to be able to retrieve specific information for another lean board. A retrieval function allows the reading of the aggregated output of an overall leanboard element (6B), and retrieves specific data to be presented.  
  
