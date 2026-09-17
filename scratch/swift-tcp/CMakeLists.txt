build_exec(
  EXECNAME swift-tcp
  SOURCE_FILES
    sim.cc
    tcp-swift.cc
  LIBRARIES_TO_LINK
    ${libapplications}
    ${libcore}
    ${libflow-monitor}
    ${libinternet}
    ${libnetwork}
    ${libpoint-to-point-layout}
    ${libpoint-to-point}
    ${libtraffic-control}
  EXECUTABLE_DIRECTORY_PATH ${CMAKE_OUTPUT_DIRECTORY}/scratch/swift-tcp
)
